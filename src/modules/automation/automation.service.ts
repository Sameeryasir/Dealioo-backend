import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import {
  Automation,
  AutomationTrigger,
} from '../../db/entities/automation.entity';
import { AutomationConnection } from '../../db/entities/automation-connection.entity';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { isBuiltinSignupPassEmailEnabled } from '../redemption/signup-qr-email.constants';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { buildGuestPassUrl } from '../../utils/guest-pass-url';
import { CouponService } from '../redemption/coupon.service';
import { GoogleWalletService } from '../google-wallet/google-wallet.service';
import { GoogleWalletStatus } from '../google-wallet/google-wallet-status';
import { ActivityService } from '../activity/activity.service';
import { BusinessHistoryService } from '../business-history/business-history.service';
import { ChatMessageService } from '../chat/chat-message.service';
import { ConversationMessageChannel } from '../../db/entities/conversation-message.entity';
import { CheckoutResumeService } from '../payment/checkout-resume.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationEmailService } from './automation-email.service';
import { AutomationRecipientsService } from './automation-recipients.service';
import { AutomationExecutionObservabilityService } from './automation-execution-observability.service';
import { AutomationRecipientDeliveryStatus } from '../../db/entities/automation-execution-recipient.entity';
import { AutomationExecutionStepStatus } from '../../db/entities/automation-execution-step.entity';
import {
  AUTOMATION_RECIPIENT_PAGE_SIZE,
  AUTOMATION_SEND_CHUNK_SIZE,
  forEachRecipientPageChunks,
  predictSendChunkCount,
} from './automation-recipient-batch.util';
import { AutomationFlowService } from './automation-flow.service';
import { AutomationCronSchedulerService } from './automation-cron-scheduler.service';
import {
  clampAutomationNodeOrder,
  isCronTriggerAutomationNode,
  isCronTriggerNodePayload,
  resolveCronFromAutomationNodes,
} from './automation-cron.config';
import { AutomationQueueService } from './automation-queue.service';
import {
  AutomationSendAttemptService,
  PAYMENT_REMINDER_EMAIL_ACTION,
  PAYMENT_REMINDER_PASS_ACTION,
  PAYMENT_REMINDER_WALLET_ACTION,
  PAYMENT_REMINDER_EXPIRY_ACTION,
} from './automation-send-attempt.service';
import { AutomationDeadLetterService } from './automation-dead-letter.service';
import { AutomationExecutionRecoveryService } from './automation-execution-recovery.service';
import { AutomationMetricsService } from './automation-metrics.service';
import type { EmailRecipient, PreparedAutomationEmail } from './automation-email.types';
import type {
  UnpaidReminderBatchJob,
  UnpaidReminderBatchPhase,
} from './automation-queue.types';
import {
  AutomationExecutionStatusDto,
  ExecuteAutomationResponseDto,
  StartAutomationExecutionResponseDto,
} from './automationDto/automation-execution-status.dto';
import {
  ExecutionListItemDto,
  type PaginatedExecutionsResponseDto,
} from './automationDto/paginated-executions.dto';
import { StartAutomationExecutionDto } from './automationDto/start-automation-execution.dto';
import { CreateAutomationConnectionDto } from './automationDto/create-automation-connection.dto';
import { CreateAutomationDto } from './automationDto/create-automation.dto';
import { CreateAutomationNodeDto } from './automationDto/create-automation-node.dto';
import { UpdateAutomationDto } from './automationDto/update-automation.dto';
import { AutomationStatusResponseDto } from './automationDto/automation-status-response.dto';
import { UpdateAutomationNodeDto } from './automationDto/update-automation-node.dto';
import { BootstrapAutomationGraphDto } from './automationDto/bootstrap-automation-graph.dto';
import { resolveWaitDelayMinutes } from './automation-wait.util';
import { assertPaymentReminderScheduleValid } from './payment-reminder-schedule.util';
import {
  signupDelayToMs,
  normalizeSignupDelayUnit,
} from './automation-signup-filter.util';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);
  /** Grep terminal for this prefix to trace scheduled payment-reminder cron reruns. */
  private static readonly PAYMENT_REMINDER_CRON_LOG = '[PaymentReminderCron]';

  constructor(
    @InjectRepository(Automation)
    private readonly automationRepository: Repository<Automation>,
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
    @InjectRepository(AutomationConnection)
    private readonly connectionRepository: Repository<AutomationConnection>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    private readonly executionService: AutomationExecutionService,
    private readonly engineService: AutomationEngineService,
    private readonly logService: AutomationLogService,
    private readonly automationEmailService: AutomationEmailService,
    private readonly recipientsService: AutomationRecipientsService,
    private readonly flowService: AutomationFlowService,
    private readonly queueService: AutomationQueueService,
    private readonly cronScheduler: AutomationCronSchedulerService,
    private readonly recoveryService: AutomationExecutionRecoveryService,
    private readonly deadLetterService: AutomationDeadLetterService,
    private readonly metricsService: AutomationMetricsService,
    private readonly observabilityService: AutomationExecutionObservabilityService,
    private readonly activityService: ActivityService,
    private readonly businessHistoryService: BusinessHistoryService,
    private readonly chatMessageService: ChatMessageService,
    private readonly checkoutResumeService: CheckoutResumeService,
    private readonly couponService: CouponService,
    private readonly googleWalletService: GoogleWalletService,
    private readonly sendAttemptService: AutomationSendAttemptService,
  ) {}

  async createAutomation(
    dto: CreateAutomationDto,
    user: User,
  ): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to create automations.');

    const { businessId, campaignId, funnelId } =
      await this.resolveScopeFromCampaign(dto.campaignId, dto.businessId);

    this.assertCreatablePurpose(dto.purpose);
    this.validatePurposeAndTrigger(dto.purpose, dto.trigger);

    const automation = this.automationRepository.create({
      businessId,
      name: dto.name,
      description: dto.description?.trim() ?? null,
      trigger: dto.trigger,
      purpose: dto.purpose,
      campaignId,
      funnelId,
      createdBy: user.id,
      isActive: dto.isActive ?? false,
      published: false,
      isTemplate: false,
    });

    const saved = await this.automationRepository.save(automation);

    if (saved.isActive) {
      await this.businessHistoryService.logAutomationActivated({
        businessId: saved.businessId,
        automationId: saved.id,
        automationName: saved.name,
        actorUserId: user.id,
      });
    }

    return saved;
  }

  async updateAutomation(
    id: number,
    dto: UpdateAutomationDto,
    user: User,
  ): Promise<Automation | AutomationStatusResponseDto> {
    requireAdminRole(user, 'You do not have permission to update automations.');

    const automation = await this.findAutomationById(id);

    const wasActive = automation.isActive;

    if (dto.name !== undefined) {
      automation.name = dto.name;
    }
    if (dto.description !== undefined) {
      automation.description = dto.description?.trim() ?? null;
    }
    if (dto.trigger !== undefined) {
      automation.trigger = dto.trigger;
    }
    if (dto.purpose !== undefined) {
      automation.purpose = dto.purpose;
    }
    if (dto.purpose !== undefined) {
      this.assertCreatablePurpose(dto.purpose);
    }
    if (dto.trigger !== undefined || dto.purpose !== undefined) {
      this.validatePurposeAndTrigger(automation.purpose, automation.trigger);
    }
    if (dto.isActive !== undefined) {
      automation.isActive = dto.isActive;
    }
    if (dto.published !== undefined) {
      automation.published = dto.published;
    }

    const willBeActive =
      dto.isActive !== undefined ? dto.isActive : automation.isActive;
    if (willBeActive) {
      await this.assertPaymentReminderScheduleForAutomation(automation);
    }

    if (dto.isTemplate !== undefined) {
      automation.isTemplate = dto.isTemplate;
    }
    if (dto.campaignId !== undefined) {
      const scope = await this.resolveScopeFromCampaign(
        dto.campaignId,
        dto.businessId,
      );
      automation.businessId = scope.businessId;
      automation.campaignId = scope.campaignId;
      automation.funnelId = scope.funnelId;
    }

    const saved = await this.automationRepository.save(automation);

    if (!saved.isActive && (wasActive || dto.isActive === false)) {
      await this.pauseAutomationExecutions(saved.id);
    }

    const becomingActive = !wasActive && saved.isActive;
    const becomingInactive = wasActive && !saved.isActive;
    const cronPaymentReminder =
      becomingActive &&
      saved.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER &&
      (await this.isCronDrivenAutomation(saved.id));

    if (cronPaymentReminder) {
      await this.closeOpenPaymentReminderRuns(saved.id);
    }

    await this.cronScheduler.syncAutomationCron(saved.id, {
      restartFromNow: cronPaymentReminder && becomingActive,
    });

    if (!cronPaymentReminder && becomingActive) {
      if (
        saved.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER
      ) {
        await this.startSignupPaymentReminderForEligibleCustomers(saved);
      }
      await this.resumePausedExecutionsForAutomation(saved.id);
    }

    if (
      !wasActive &&
      saved.isActive &&
      saved.purpose === AutomationPurpose.FUNNEL_PAYMENT
    ) {
      this.logPrepaidOfferActivated(saved, 'updated');
    }

    if (becomingActive) {
      await this.businessHistoryService.logAutomationActivated({
        businessId: saved.businessId,
        automationId: saved.id,
        automationName: saved.name,
        actorUserId: user.id,
      });
    } else if (becomingInactive) {
      await this.businessHistoryService.logAutomationDeactivated({
        businessId: saved.businessId,
        automationId: saved.id,
        automationName: saved.name,
        actorUserId: user.id,
      });
    } else {
      await this.businessHistoryService.logAutomationUpdated({
        businessId: saved.businessId,
        automationId: saved.id,
        automationName: saved.name,
        actorUserId: user.id,
      });
    }

    if (this.isStatusOnlyUpdate(dto)) {
      return this.toAutomationStatusResponse(saved);
    }

    return saved;
  }

  private isStatusOnlyUpdate(dto: UpdateAutomationDto): boolean {
    const definedKeys = (
      Object.keys(dto) as Array<keyof UpdateAutomationDto>
    ).filter((key) => dto[key] !== undefined);
    if (definedKeys.length === 0) {
      return false;
    }
    return definedKeys.every(
      (key) => key === 'isActive' || key === 'published',
    );
  }

  private toAutomationStatusResponse(
    automation: Automation,
  ): AutomationStatusResponseDto {
    return {
      id: automation.id,
      status: automation.isActive
        ? 'active'
        : automation.published
          ? 'published'
          : 'deactivated',
    };
  }

  private logPrepaidOfferActivated(
    automation: Automation,
    source: 'activated' | 'updated',
  ): void {
    this.logger.log(
      `[Prepaid Offer] Automation ${source}: id=${automation.id} name="${automation.name}" businessId=${automation.businessId} funnelId=${automation.funnelId ?? 'all'} campaignId=${automation.campaignId ?? 'none'}`,
    );
  }

  async getAutomations(businessId?: number): Promise<Automation[]> {
    if (businessId) {
      const business = await this.businessRepository.findOne({
        where: { id: businessId },
      });
      if (!business) {
        throw new NotFoundException('Business not found');
      }
      return this.automationRepository.find({
        where: { businessId },
        order: { createdAt: 'DESC' },
      });
    }

    return this.automationRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findAutomationById(id: number): Promise<Automation> {
    const automation = await this.automationRepository.findOne({
      where: { id },
      relations: ['nodes', 'connections'],
    });
    if (!automation) {
      throw new NotFoundException('Automation not found');
    }
    return automation;
  }

  async deleteAutomation(id: number, user: User): Promise<void> {
    requireAdminRole(user, 'You do not have permission to delete automations.');
    const automation = await this.findAutomationById(id);
    const executionIds =
      await this.executionService.findExecutionIdsByAutomationId(id);
    await this.queueService.purgeAutomationJobs(id, executionIds);

    await this.businessHistoryService.logAutomationDeleted({
      businessId: automation.businessId,
      automationId: automation.id,
      automationName: automation.name,
      actorUserId: user.id,
    });

    await this.automationRepository.remove(automation);
  }

  async deleteAutomationsForCampaign(
    campaignId: number,
    funnelId?: number | null,
  ): Promise<number> {
    const where =
      funnelId != null && funnelId > 0
        ? [{ campaignId }, { funnelId }]
        : [{ campaignId }];

    const automations = await this.automationRepository.find({ where });
    if (automations.length === 0) {
      return 0;
    }

    for (const automation of automations) {
      const executionIds =
        await this.executionService.findExecutionIdsByAutomationId(
          automation.id,
        );
      await this.queueService.purgeAutomationJobs(
        automation.id,
        executionIds,
      );
      await this.automationRepository.remove(automation);
      this.logger.log(
        `Deleted automation ${automation.id} "${automation.name}" with campaign ${campaignId} (purged ${executionIds.length} execution job(s))`,
      );
    }

    return automations.length;
  }

  async publishAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to publish automations.');
    const automation = await this.findAutomationById(id);
    automation.published = true;
    const saved = await this.automationRepository.save(automation);
    await this.bumpAutomationGraphVersion(saved.id);
    await this.cronScheduler.syncAutomationCron(saved.id);
    return saved;
  }

  async activateAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to activate automations.');
    const automation = await this.findAutomationById(id);
    await this.assertPaymentReminderScheduleForAutomation(automation);
    const wasActive = automation.isActive;
    automation.isActive = true;
    if (!automation.published) {
      automation.published = true;
    }
    const saved = await this.automationRepository.save(automation);

    const becomingActive = !wasActive && saved.isActive;
    const cronPaymentReminder =
      saved.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER &&
      (await this.isCronDrivenAutomation(saved.id));

    if (cronPaymentReminder) {
      await this.closeOpenPaymentReminderRuns(saved.id);
    }

    await this.cronScheduler.syncAutomationCron(saved.id, {
      restartFromNow: becomingActive && cronPaymentReminder,
    });

    if (!cronPaymentReminder && becomingActive) {
      if (
        saved.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER
      ) {
        await this.startSignupPaymentReminderForEligibleCustomers(saved);
      }
      await this.resumePausedExecutionsForAutomation(saved.id);
    }

    if (saved.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
      this.logPrepaidOfferActivated(saved, 'activated');
    }

    if (becomingActive) {
      await this.businessHistoryService.logAutomationActivated({
        businessId: saved.businessId,
        automationId: saved.id,
        automationName: saved.name,
        actorUserId: user.id,
      });
    }

    return saved;
  }

  async deactivateAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(
      user,
      'You do not have permission to deactivate automations.',
    );
    const automation = await this.findAutomationById(id);
    const wasActive = automation.isActive;
    automation.isActive = false;
    const saved = await this.automationRepository.save(automation);
    await this.cronScheduler.syncAutomationCron(saved.id);
    await this.pauseAutomationExecutions(saved.id);

    if (wasActive) {
      await this.businessHistoryService.logAutomationDeactivated({
        businessId: saved.businessId,
        automationId: saved.id,
        automationName: saved.name,
        actorUserId: user.id,
      });
    }

    return saved;
  }

  private async pauseAutomationExecutions(automationId: number): Promise<void> {
    const pausedExecutionIds =
      await this.executionService.pauseInProgressExecutionsForAutomation(
        automationId,
      );

    const executionIds =
      await this.executionService.findExecutionIdsByAutomationId(automationId);
    await this.queueService.purgeAutomationJobs(automationId, executionIds);

    for (const executionId of pausedExecutionIds) {
      const execution = await this.executionService.findById(executionId);
      await this.logService.createLog({
        executionId,
        nodeId: execution.currentNodeId,
        customerId: execution.customerId,
        message:
          'Automation paused — run stopped and Redis scheduled jobs cleared',
      });
    }

    this.logger.log(
      `Deactivated automation ${automationId}: paused ${pausedExecutionIds.length} run(s), purged Redis jobs for ${executionIds.length} execution(s)`,
    );
  }

  private async resumePausedExecutionsForAutomation(
    automationId: number,
  ): Promise<void> {
    const executions =
      await this.executionService.findPausedExecutionsForAutomation(
        automationId,
      );

    for (const execution of executions) {
      await this.resumePausedExecution(execution);
    }
  }

  private async closeOpenPaymentReminderRuns(
    automationId: number,
  ): Promise<void> {
    const openExecutionIds =
      await this.executionService.findOpenExecutionIdsForAutomation(
        automationId,
      );

    if (openExecutionIds.length === 0) {
      return;
    }

    await this.queueService.purgeExecutionJobs(openExecutionIds);

    for (const executionId of openExecutionIds) {
      const execution = await this.executionService.findById(executionId);
      await this.logService.createLog({
        executionId,
        nodeId: execution.currentNodeId,
        customerId: execution.customerId,
        message:
          'Previous run closed after resume — rechecking unpaid guests',
      });
      await this.executionService.markCompleted(executionId);
    }

    this.logger.log(
      `Closed ${openExecutionIds.length} open payment-reminder run(s) for automation ${automationId}`,
    );
  }

  private async resumePausedExecution(
    execution: AutomationExecution,
  ): Promise<void> {
    const postVisitNodeId =
      await this.engineService.resolvePostVisitResumeNodeId(execution);

    if (postVisitNodeId) {
      await this.executionService.clearPauseState(
        execution.id,
        AutomationExecutionStatus.RUNNING,
        null,
      );
      await this.executionService.updateCurrentNode(
        execution.id,
        postVisitNodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );
      await this.logService.createLog({
        executionId: execution.id,
        nodeId: postVisitNodeId,
        customerId: execution.customerId,
        message:
          'Automation reactivated after visit — continuing to post-visit thank-you emails',
      });
      const postVisitNode = await this.executionService.findNodeForAutomation(
        execution.automationId,
        postVisitNodeId,
      );
      await this.queueService.addProcessExecution({
        executionId: execution.id,
        nodeId: postVisitNodeId,
        nodeType: postVisitNode.type,
      });
      return;
    }

    const node =
      execution.currentNode ??
      (await this.executionService.findNodeForAutomation(
        execution.automationId,
        execution.currentNodeId,
      ));
    const pausedFromStatus = String(
      execution.executionContext?.pausedFromStatus ?? '',
    );
    const wasWaiting =
      pausedFromStatus === AutomationExecutionStatus.WAITING ||
      node.type === AutomationNodeType.WAIT;

    if (wasWaiting && execution.scheduledAt) {
      const delayMs = execution.scheduledAt.getTime() - Date.now();
      if (delayMs > 0) {
        await this.executionService.clearPauseState(
          execution.id,
          AutomationExecutionStatus.WAITING,
          execution.scheduledAt,
        );
        return;
      }
    }

    if (wasWaiting || node.type === AutomationNodeType.WAIT) {
      await this.executionService.clearPauseState(
        execution.id,
        AutomationExecutionStatus.RUNNING,
        null,
      );
      await this.queueService.addResumeExecution(
        { executionId: execution.id },
        0,
      );
      return;
    }

    await this.executionService.clearPauseState(
      execution.id,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    await this.queueService.addProcessExecution({
      executionId: execution.id,
      nodeId: execution.currentNodeId,
      nodeType: node.type,
    });
  }

  private async assertAutomationEditable(automationId: number): Promise<void> {
    const automation = await this.automationRepository.findOne({
      where: { id: automationId },
      select: ['id', 'isActive'],
    });
    if (!automation) {
      throw new NotFoundException('Automation not found');
    }
    if (automation.isActive) {
      throw new BadRequestException(
        'Deactivate this automation before editing it.',
      );
    }
  }

  async createNode(dto: CreateAutomationNodeDto): Promise<AutomationNode> {
    await this.findAutomationById(dto.automationId);
    await this.assertAutomationEditable(dto.automationId);

    const existingNodes = await this.nodeRepository.find({
      where: { automationId: dto.automationId },
      order: { order: 'ASC', id: 'ASC' },
    });

    const creatingCron = isCronTriggerNodePayload(
      dto.type,
      dto.config ?? {},
    );

    if (creatingCron && existingNodes.some(isCronTriggerAutomationNode)) {
      throw new BadRequestException(
        'This automation already has a Cron Job trigger.',
      );
    }

    const order = creatingCron
      ? 0
      : clampAutomationNodeOrder(
          {
            id: 0,
            automationId: dto.automationId,
            type: dto.type,
            config: dto.config ?? {},
            positionX: dto.positionX ?? 0,
            positionY: dto.positionY ?? 0,
            order: dto.order,
          } as AutomationNode,
          dto.order,
          existingNodes,
        );

    if (creatingCron && existingNodes.length > 0) {
      for (const node of existingNodes) {
        node.order += 1;
      }
      await this.nodeRepository.save(existingNodes);
    }

    const node = this.nodeRepository.create({
      automationId: dto.automationId,
      type: dto.type,
      config: dto.config ?? {},
      positionX: dto.positionX ?? 0,
      positionY: dto.positionY ?? 0,
      order,
    });

    const saved = await this.nodeRepository.save(node);
    await this.bumpAutomationGraphVersion(saved.automationId);
    await this.cronScheduler.syncAutomationCron(saved.automationId);
    return saved;
  }

  async getNodesByFunnelId(funnelId: number): Promise<{
    funnelId: number;
    automationIds: number[];
    nodes: AutomationNode[];
    connections: AutomationConnection[];
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const automations = await this.automationRepository.find({
      where: { funnelId },
      select: ['id'],
    });

    if (automations.length === 0) {
      return { funnelId, automationIds: [], nodes: [], connections: [] };
    }

    const automationIds = automations.map((automation) => automation.id);

    const nodes = await this.nodeRepository.find({
      where: { automationId: In(automationIds) },
      order: { order: 'ASC', id: 'ASC' },
    });

    const connections = await this.connectionRepository.find({
      where: { automationId: In(automationIds) },
    });

    return { funnelId, automationIds, nodes, connections };
  }

  async updateNode(
    id: number,
    dto: UpdateAutomationNodeDto,
  ): Promise<AutomationNode> {
    const node = await this.nodeRepository.findOne({ where: { id } });
    if (!node) {
      throw new NotFoundException('Automation node not found');
    }

    const structuralChange =
      dto.type !== undefined || dto.order !== undefined;
    if (structuralChange) {
      await this.assertAutomationEditable(node.automationId);
    }

    if (dto.type !== undefined) {
      node.type = dto.type;
    }
    if (dto.config !== undefined) {
      node.config = dto.config;
    }
    if (dto.positionX !== undefined) {
      node.positionX = dto.positionX;
    }
    if (dto.positionY !== undefined) {
      node.positionY = dto.positionY;
    }
    if (dto.order !== undefined) {
      const siblings = await this.nodeRepository.find({
        where: { automationId: node.automationId },
        order: { order: 'ASC', id: 'ASC' },
      });
      node.order = clampAutomationNodeOrder(node, dto.order, siblings);
    }

    const automation = await this.automationRepository.findOne({
      where: { id: node.automationId },
    });
    if (automation) {
      const siblings = await this.nodeRepository.find({
        where: { automationId: node.automationId },
        order: { order: 'ASC', id: 'ASC' },
      });
      const nodesForValidation = siblings.map((sibling) =>
        sibling.id === node.id ? node : sibling,
      );
      assertPaymentReminderScheduleValid(
        automation.purpose,
        nodesForValidation,
      );
    }

    const saved = await this.nodeRepository.save(node);
    await this.bumpAutomationGraphVersion(saved.automationId);
    const automationAfterSave = await this.automationRepository.findOne({
      where: { id: saved.automationId },
      select: ['id', 'isActive', 'published'],
    });
    const cronConfigChanged =
      dto.config !== undefined && isCronTriggerAutomationNode(saved);
    await this.cronScheduler.syncAutomationCron(saved.automationId, {
      restartFromNow:
        cronConfigChanged &&
        automationAfterSave?.isActive === true &&
        automationAfterSave?.published === true,
    });
    return saved;
  }

  async deleteNode(id: number): Promise<void> {
    const node = await this.nodeRepository.findOne({ where: { id } });
    if (!node) {
      throw new NotFoundException('Automation node not found');
    }
    await this.assertAutomationEditable(node.automationId);
    const automationId = node.automationId;
    await this.nodeRepository.remove(node);
    await this.bumpAutomationGraphVersion(automationId);
    await this.cronScheduler.syncAutomationCron(automationId);
  }

  async createConnection(
    dto: CreateAutomationConnectionDto,
  ): Promise<AutomationConnection> {
    await this.findAutomationById(dto.automationId);
    await this.assertAutomationEditable(dto.automationId);

    const source = await this.nodeRepository.findOne({
      where: { id: dto.sourceNodeId, automationId: dto.automationId },
    });
    const target = await this.nodeRepository.findOne({
      where: { id: dto.targetNodeId, automationId: dto.automationId },
    });

    if (!source || !target) {
      throw new BadRequestException(
        'Source and target nodes must belong to this automation',
      );
    }

    const connection = this.connectionRepository.create({
      automationId: dto.automationId,
      sourceNodeId: dto.sourceNodeId,
      targetNodeId: dto.targetNodeId,
    });

    const saved = await this.connectionRepository.save(connection);
    await this.bumpAutomationGraphVersion(saved.automationId);
    return saved;
  }

  async bootstrapAutomationGraph(
    automationId: number,
    dto: BootstrapAutomationGraphDto,
    user: User,
  ): Promise<Automation> {
    requireAdminRole(
      user,
      'You do not have permission to update automations.',
    );

    await this.findAutomationById(automationId);
    await this.assertAutomationEditable(automationId);

    const existingNodeCount = await this.nodeRepository.count({
      where: { automationId },
    });
    if (existingNodeCount > 0) {
      throw new BadRequestException(
        'This automation already has workflow steps.',
      );
    }

    await this.nodeRepository.manager.transaction(async (manager) => {
      const nodeRepo = manager.getRepository(AutomationNode);
      const connectionRepo = manager.getRepository(AutomationConnection);

      const savedNodes: AutomationNode[] = [];
      for (const [index, nodeDef] of dto.nodes.entries()) {
        const node = nodeRepo.create({
          automationId,
          type: nodeDef.type,
          config: nodeDef.config ?? {},
          positionX: nodeDef.positionX ?? 0,
          positionY: nodeDef.positionY ?? 200 + index * 120,
          order: nodeDef.order ?? index,
        });
        savedNodes.push(await nodeRepo.save(node));
      }

      for (const connectionDef of dto.connections) {
        const source = savedNodes[connectionDef.sourceIndex];
        const target = savedNodes[connectionDef.targetIndex];
        if (!source || !target) {
          throw new BadRequestException(
            'Template connection references an invalid step index.',
          );
        }

        await connectionRepo.save(
          connectionRepo.create({
            automationId,
            sourceNodeId: source.id,
            targetNodeId: target.id,
          }),
        );
      }
    });

    await this.bumpAutomationGraphVersion(automationId);
    await this.cronScheduler.syncAutomationCron(automationId);

    return this.findAutomationById(automationId);
  }

  async deleteConnection(id: number): Promise<void> {
    const connection = await this.connectionRepository.findOne({
      where: { id },
    });
    if (!connection) {
      throw new NotFoundException('Automation connection not found');
    }
    const automationId = connection.automationId;
    await this.connectionRepository.remove(connection);
    await this.bumpAutomationGraphVersion(automationId);
  }

  async getExecutions(
    filters: {
      automationId?: number;
      customerId?: number;
      status?: AutomationExecutionStatus;
    },
    page?: number,
    limit?: number,
  ): Promise<PaginatedExecutionsResponseDto> {
    const { items, meta } = await this.executionService.findExecutionsPaginated(
      filters,
      page,
      limit,
    );
    const data = items.map((execution) => this.toExecutionListItem(execution));

    let summary: PaginatedExecutionsResponseDto['meta']['summary'];
    if (filters.automationId !== undefined) {
      const [counts, customersReached] = await Promise.all([
        this.executionService.getExecutionListSummary(filters.automationId),
        this.logService.countDistinctEmailRecipientsForAutomation(
          filters.automationId,
        ),
      ]);
      summary = {
        ...counts,
        customersReached,
      };
    }

    return {
      data,
      meta: summary ? { ...meta, summary } : meta,
    };
  }

  async getExecutionById(id: number): Promise<AutomationExecution> {
    const execution = await this.executionService.findById(id);
    const [enriched] = await this.attachExecutedRecipients([execution]);
    return enriched;
  }

  async deleteExecution(id: number, user: User): Promise<void> {
    requireAdminRole(
      user,
      'You do not have permission to delete automation executions.',
    );

    const execution = await this.executionService.findById(id);

    if (
      execution.status === AutomationExecutionStatus.QUEUED ||
      execution.status === AutomationExecutionStatus.RUNNING ||
      execution.status === AutomationExecutionStatus.WAITING
    ) {
      throw new ConflictException(
        'Cannot delete an execution that is still queued, running, or waiting.',
      );
    }

    if (execution.status === AutomationExecutionStatus.PAUSED) {
      await this.queueService.purgeExecutionJobs([id]);
    }

    await this.executionService.deleteById(id);
  }

  async getExecutionStatus(
    executionId: number,
  ): Promise<AutomationExecutionStatusDto> {
    const execution = await this.executionService.findById(executionId);
    return this.buildExecutionStatusDto(execution);
  }

  private resolveExecutionCustomerCount(
    execution: AutomationExecution,
  ): number {
    if (execution.totalRecipients > 0) {
      return execution.totalRecipients;
    }
    if (execution.customerId) {
      return 1;
    }
    return 0;
  }

  private toExecutionListItem(
    execution: AutomationExecution,
  ): ExecutionListItemDto {
    return {
      runId: execution.id,
      id: execution.id,
      status: execution.status,
      startedAt: execution.createdAt,
      customerCount: this.resolveExecutionCustomerCount(execution),
      customerId: execution.customerId ?? null,
      customerEmail: execution.customer?.email ?? null,
      customerName: execution.customer?.name ?? null,
      totalRecipients: execution.totalRecipients ?? 0,
      emailsSentCount: execution.emailsSentCount ?? 0,
      scheduledAt: execution.scheduledAt ?? null,
      stepType: execution.currentNode?.type ?? null,
    };
  }

  private buildExecutionStatusDto(
    execution: AutomationExecution,
  ): AutomationExecutionStatusDto {
    const isTerminal =
      execution.status === AutomationExecutionStatus.COMPLETED ||
      execution.status === AutomationExecutionStatus.FAILED;

    const total = execution.totalRecipients ?? 0;
    const sent = execution.emailsSentCount ?? 0;
    let progressPercent = 0;
    if (total > 0) {
      progressPercent = Math.min(100, Math.round((sent / total) * 100));
    } else if (execution.status === AutomationExecutionStatus.COMPLETED) {
      progressPercent = 100;
    }

    return {
      executionId: execution.id,
      automationId: execution.automationId,
      status: execution.status,
      isTerminal,
      totalRecipients: total,
      emailsSent: sent,
      progressPercent,
      queueJobId: execution.queueJobId ?? null,
      lastError: execution.lastError ?? null,
      createdAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    };
  }

  private async attachExecutedRecipients(
    executions: AutomationExecution[],
  ): Promise<AutomationExecution[]> {
    if (executions.length === 0) {
      return executions;
    }

    const recipientMap = await this.logService.findEmailRecipientsByExecutionIds(
      executions.map((execution) => execution.id),
    );

    return executions.map((execution) =>
      Object.assign(execution, {
        executedRecipients: recipientMap.get(execution.id) ?? [],
      }),
    );
  }

  async getExecutionLogs(executionId: number): Promise<AutomationLog[]> {
    await this.executionService.findById(executionId);
    return this.logService.findByExecutionId(executionId);
  }

  async getAutomationLogs(automationId: number): Promise<AutomationLog[]> {
    await this.findAutomationById(automationId);
    return this.logService.findByAutomationId(automationId);
  }

  async startExecution(
    dto: StartAutomationExecutionDto,
    user: User,
  ): Promise<StartAutomationExecutionResponseDto> {
    requireAdminRole(
      user,
      'You do not have permission to start automation executions.',
    );

    const automation = await this.automationRepository.findOne({
      where: { id: dto.automationId },
      relations: ['nodes', 'connections', 'campaign'],
    });
    if (!automation) {
      throw new NotFoundException('Automation not found');
    }

    if (!automation.isActive) {
      throw new BadRequestException('Automation is not active');
    }

    if (!automation.funnelId) {
      throw new BadRequestException('Automation has no funnel linked');
    }

    if (automation.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
      const result = await this.enqueuePrepaidOfferBatch(automation, {
        skipIfNoRecipients: false,
      });
      if (!result) {
        throw new BadRequestException(
          'No paid customers found for this funnel',
        );
      }
      return result;
    }

    const alreadyRunning =
      await this.executionService.hasActiveExecutionForAutomation(
        dto.automationId,
      );
    if (alreadyRunning) {
      throw new ConflictException(
        'This automation is already running. Wait for it to finish before starting again.',
      );
    }

    const result = await this.enqueueUnpaidReminderBatch(automation, {
      skipIfNoRecipients: false,
      triggeredByCron: false,
    });
    if (!result) {
      throw new BadRequestException(
        'No unpaid customers found for this funnel',
      );
    }

    return result;
  }

  async runCronTick(automationId: number): Promise<void> {
    const verified =
      await this.cronScheduler.verifyAndRefreshBeforeRun(automationId);
    if (!verified) {
      return;
    }

    const automation = await this.automationRepository.findOne({
      where: { id: automationId },
      relations: ['campaign'],
    });

    if (!automation?.isActive || !automation.published) {
      return;
    }

    if (!automation.funnelId) {
      this.logger.warn(
        `Cron tick skipped for automation ${automationId}: no funnel linked`,
      );
      return;
    }

    if (automation.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
      try {
        const result = await this.enqueuePrepaidOfferBatch(automation, {
          skipIfNoRecipients: true,
        });
        if (!result) {
          this.logger.log(
            `Cron tick for prepaid automation ${automationId}: no eligible paid recipients`,
          );
        } else {
          this.logger.log(
            `Cron tick started prepaid-offer batch for automation ${automationId} (execution=${result.status.executionId}, paid≈${result.status.totalRecipients ?? '?'})`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Prepaid batch enqueue failed';
        this.logger.warn(
          `Cron tick failed for prepaid automation ${automationId}: ${message}`,
        );
      }
      return;
    }

    const openExecutions =
      await this.executionService.findOpenExecutionsForAutomation(
        automationId,
      );
    if (openExecutions.length > 0) {
      const openSummary = openExecutions
        .map((row) => `#${row.id}:${row.status}`)
        .join(', ');
      this.logger.log(
        `${AutomationService.PAYMENT_REMINDER_CRON_LOG} TICK SKIPPED automation=${automationId} reason=previous_run_still_open openRuns=${openSummary} action=will_retry_on_next_interval`,
      );
      return;
    }

    const previousCompletedRun =
      await this.executionService.findLatestCompletedExecutionId(automationId);
    const isRerun = previousCompletedRun != null;

    try {
      this.logger.log(
        `${AutomationService.PAYMENT_REMINDER_CRON_LOG} TICK FIRED automation=${automationId} rerun=${isRerun} previousCompletedRun=${previousCompletedRun ?? 'none'} interval=${verified.interval}${verified.unit} action=start_at_cron_node`,
      );
      const result = await this.enqueueUnpaidReminderBatch(automation, {
        skipIfNoRecipients: true,
        triggeredByCron: true,
      });
      if (!result) {
        this.logger.log(
          `${AutomationService.PAYMENT_REMINDER_CRON_LOG} TICK NOOP automation=${automationId} rerun=${isRerun} reason=no_unpaid_recipients`,
        );
      } else {
        this.logger.log(
          `${AutomationService.PAYMENT_REMINDER_CRON_LOG} RERUN STARTED automation=${automationId} execution=${result.status.executionId} rerun=${isRerun} previousCompletedRun=${previousCompletedRun ?? 'none'} unpaid=${result.status.totalRecipients ?? '?'}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Cron batch enqueue failed';
      this.logger.warn(
        `Cron tick failed for automation ${automationId}: ${message}`,
      );
    }
  }

  private async enqueueUnpaidReminderBatch(
    automation: Automation,
    options: { skipIfNoRecipients: boolean; triggeredByCron: boolean },
  ): Promise<StartAutomationExecutionResponseDto | null> {
    const plan = await this.flowService.buildExecutionPlan(automation.id);
    const actionNode = plan.emailNode ?? plan.smsNode;
    if (!actionNode) {
      throw new BadRequestException(
        'Flow must include an email or SMS node (check node_order and type).',
      );
    }

    if (!plan.sendToUnpaidOnly) {
      throw new BadRequestException(
        'Flow condition must target customers who have not completed payment.',
      );
    }

    const campaignName =
      automation.campaign?.campaignName?.trim() || 'the campaign';
    const prepared = this.automationEmailService.prepareFromActionNode(
      actionNode,
      automation.purpose,
      {
        requireSubject: Boolean(plan.emailNode),
        campaignName,
      },
    );

    if (
      automation.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER
    ) {
      if (!String(prepared.templateProps.ctaLabel ?? '').trim()) {
        prepared.templateProps.ctaLabel = 'Complete payment';
      }
    }

    let passPrepared: PreparedAutomationEmail | null = null;
    let waitDelayMs = 0;
    let walletPrepared: PreparedAutomationEmail | null = null;
    let waitBeforeWalletDelayMs = 0;
    let expiryPrepared: PreparedAutomationEmail | null = null;
    let waitBeforeExpiryDelayMs = 0;
    let expiryWithinAmount: number | null = null;
    let expiryWithinUnit: string | null = null;
    if (plan.passEmailNode) {
      passPrepared = this.automationEmailService.prepareFromActionNode(
        plan.passEmailNode,
        automation.purpose,
        { requireSubject: false, campaignName },
      );
      if (!String(passPrepared.templateProps.ctaLabel ?? '').trim()) {
        passPrepared.templateProps.ctaLabel = 'View my pass';
      }
      if (plan.waitBeforePassNode) {
        waitDelayMs =
          resolveWaitDelayMinutes(plan.waitBeforePassNode.config ?? {}) *
          60_000;
      }
    }
    if (plan.walletEmailNode) {
      walletPrepared = this.automationEmailService.prepareFromActionNode(
        plan.walletEmailNode,
        automation.purpose,
        { requireSubject: false, campaignName },
      );
      if (!String(walletPrepared.templateProps.ctaLabel ?? '').trim()) {
        walletPrepared.templateProps.ctaLabel = 'View my pass';
      }
      if (plan.waitBeforeWalletNode) {
        waitBeforeWalletDelayMs =
          resolveWaitDelayMinutes(plan.waitBeforeWalletNode.config ?? {}) *
          60_000;
      }
    }
    if (plan.expiryEmailNode) {
      expiryPrepared = this.automationEmailService.prepareFromActionNode(
        plan.expiryEmailNode,
        automation.purpose,
        { requireSubject: false, campaignName },
      );
      if (!String(expiryPrepared.templateProps.ctaLabel ?? '').trim()) {
        expiryPrepared.templateProps.ctaLabel = 'Complete payment';
      }
      if (plan.waitBeforeExpiryNode) {
        waitBeforeExpiryDelayMs =
          resolveWaitDelayMinutes(plan.waitBeforeExpiryNode.config ?? {}) *
          60_000;
      }
      const parsed = plan.expiryFilterNode
        ? this.flowService.parseOfferExpiresWithin(
            plan.expiryFilterNode.config ?? {},
          )
        : null;
      expiryWithinAmount = parsed?.amount ?? 3;
      expiryWithinUnit = parsed?.unit ?? 'days';
    }

    const unpaidCount =
      await this.recipientsService.countUnpaidCustomersForFunnel(
        automation.funnelId!,
      );
    if (unpaidCount === 0) {
      if (options.skipIfNoRecipients) {
        return null;
      }
      throw new BadRequestException(
        'No unpaid customers found for this funnel',
      );
    }

    const firstPage =
      await this.recipientsService.getUnpaidCustomersForFunnelPage(
        automation.funnelId!,
        { afterCustomerId: 0, limit: AUTOMATION_RECIPIENT_PAGE_SIZE },
      );
    const firstCustomerId = firstPage[0]?.customerId;
    if (firstCustomerId == null) {
      if (options.skipIfNoRecipients) {
        return null;
      }
      throw new BadRequestException(
        'No unpaid customers found for this funnel',
      );
    }

    const anchorStepOnTrigger = options.triggeredByCron;
    const initialNodeId = anchorStepOnTrigger
      ? plan.startNodeId
      : this.flowService.resolveBulkRunStartNodeId(plan);

    const execution = await this.executionService.createExecution(
      {
        automationId: automation.id,
        currentNodeId: initialNodeId,
        purpose: automation.purpose,
      },
      firstCustomerId,
      {
        status: AutomationExecutionStatus.QUEUED,
        totalRecipients: unpaidCount,
      },
    );

    if (options.triggeredByCron) {
      await this.executionService.updateCurrentNode(
        execution.id,
        plan.startNodeId,
        AutomationExecutionStatus.RUNNING,
      );
    }

    const predictedTotalChunks = predictSendChunkCount(
      unpaidCount,
      AUTOMATION_SEND_CHUNK_SIZE,
    );

    this.logger.log(
      `Payment reminder enqueue start automation=${automation.id} execution=${execution.id} funnel=${automation.funnelId} unpaid=${unpaidCount} pageSize=${AUTOMATION_RECIPIENT_PAGE_SIZE} chunkSize=${AUTOMATION_SEND_CHUNK_SIZE} predictedChunks=${predictedTotalChunks} cron=${options.triggeredByCron}`,
    );
    if (options.triggeredByCron) {
      this.logger.log(
        `${AutomationService.PAYMENT_REMINDER_CRON_LOG} CRON NODE execution=${execution.id} automation=${automation.id} cronNodeId=${plan.startNodeId} unpaid=${unpaidCount}`,
      );
    }

    await this.logService.createLog({
      executionId: execution.id,
      nodeId: initialNodeId,
      customerId: firstCustomerId,
      message: options.triggeredByCron
        ? `Trigger fired (cron) — starting workflow (${unpaidCount} unpaid guest(s))`
        : `Payment reminder started: ${unpaidCount} unpaid guest(s), queuing in pages of ${AUTOMATION_RECIPIENT_PAGE_SIZE} and send chunks of ${AUTOMATION_SEND_CHUNK_SIZE} (~${predictedTotalChunks} chunk job(s))`,
    });

    void this.observabilityService.onBatchExecutionCreated({
      executionId: execution.id,
      nodeId: initialNodeId,
      emailNodeId: actionNode.id,
      unpaidCount,
      triggeredByCron: options.triggeredByCron,
    });

    const baseBatch: Omit<
      UnpaidReminderBatchJob,
      'customerIds' | 'recipients' | 'chunkIndex' | 'totalChunks'
    > = {
      executionId: execution.id,
      automationId: automation.id,
      businessId: automation.businessId,
      funnelId: automation.funnelId!,
      campaignId: automation.campaignId ?? automation.campaign?.id ?? null,
      emailNodeId: actionNode.id,
      conditionNodeId: plan.conditionNode?.id ?? actionNode.id,
      purpose: automation.purpose,
      prepared,
      plan,
      anchorStepOnTrigger,
      batchPhase: 'payment',
      passPrepared,
      passEmailNodeId: plan.passEmailNode?.id ?? null,
      waitBeforePassNodeId: plan.waitBeforePassNode?.id ?? null,
      waitDelayMs,
      walletPrepared,
      walletEmailNodeId: plan.walletEmailNode?.id ?? null,
      waitBeforeWalletNodeId: plan.waitBeforeWalletNode?.id ?? null,
      waitBeforeWalletDelayMs,
      walletFilterNodeId: plan.walletFilterNode?.id ?? null,
      expiryPrepared,
      expiryEmailNodeId: plan.expiryEmailNode?.id ?? null,
      waitBeforeExpiryNodeId: plan.waitBeforeExpiryNode?.id ?? null,
      waitBeforeExpiryDelayMs,
      expiryFilterNodeId: plan.expiryFilterNode?.id ?? null,
      expiryWithinAmount,
      expiryWithinUnit,
    };

    const { totalChunks, firstQueueJobId } =
      await this.enqueueUnpaidReminderChunksFromPages({
        funnelId: automation.funnelId!,
        baseBatch,
        delayMs: 0,
        seedPage: firstPage,
        predictedTotalChunks,
      });

    this.logger.log(
      `Payment reminder enqueue done execution=${execution.id} queuedChunks=${totalChunks}`,
    );
    if (totalChunks > 0) {
      await this.logService.createLog({
        executionId: execution.id,
        nodeId: actionNode.id,
        customerId: firstCustomerId,
        message: `Queued ${totalChunks} send chunk job(s) for ${unpaidCount} unpaid guest(s)`,
      });
    }

    if (totalChunks === 0) {
      await this.executionService.markFailed(
        execution.id,
        'No unpaid customers found for this funnel',
      );
      if (options.skipIfNoRecipients) {
        return null;
      }
      throw new BadRequestException(
        'No unpaid customers found for this funnel',
      );
    }

    if (firstQueueJobId) {
      await this.executionService.setQueueJobId(execution.id, firstQueueJobId);
    }

    return {
      status: await this.getExecutionStatus(execution.id),
    };
  }

  private async enqueueUnpaidReminderChunksFromPages(options: {
    funnelId: number;
    baseBatch: Omit<
      UnpaidReminderBatchJob,
      'customerIds' | 'recipients' | 'chunkIndex' | 'totalChunks'
    >;
    delayMs: number;
    seedPage?: EmailRecipient[];
    predictedTotalChunks?: number;
  }): Promise<{ totalChunks: number; firstQueueJobId: string | null }> {
    const phase = options.baseBatch.batchPhase ?? 'payment';

    if (
      options.predictedTotalChunks != null &&
      options.predictedTotalChunks > 0
    ) {
      await this.queueService.setUnpaidReminderChunkTotal(
        options.baseBatch.executionId,
        phase,
        options.predictedTotalChunks,
      );
    }

    let firstQueueJobId: string | null = null;
    const pageChunkCounts = new Map<number, number>();

    const { totalChunks } = await forEachRecipientPageChunks({
      seedPage: options.seedPage,
      pageSize: AUTOMATION_RECIPIENT_PAGE_SIZE,
      chunkSize: AUTOMATION_SEND_CHUNK_SIZE,
      fetchPage: (afterCustomerId, limit) =>
        this.recipientsService.getUnpaidCustomersForFunnelPage(options.funnelId, {
          afterCustomerId,
          limit,
        }),
      onChunk: async (chunk, meta) => {
        const customerIds = chunk
          .map((recipient) => recipient.customerId)
          .filter((id): id is number => id != null && id > 0);

        const queueJobId = await this.queueService.addUnpaidReminderBatch(
          {
            ...options.baseBatch,
            customerIds,
            recipients: [],
            chunkIndex: meta.chunkIndex,
            totalChunks:
              options.predictedTotalChunks ?? Math.max(meta.chunkIndex + 1, 1),
          },
          options.delayMs,
        );

        this.logger.log(
          `Payment reminder queued ${phase} chunk ${meta.chunkIndex + 1} execution=${options.baseBatch.executionId} guests=${customerIds.length} jobId=${queueJobId}`,
        );

        if (firstQueueJobId == null) {
          firstQueueJobId = queueJobId;
        }
        pageChunkCounts.set(
          meta.pageNumber,
          (pageChunkCounts.get(meta.pageNumber) ?? 0) + 1,
        );
      },
    });

    for (const [pageNumber, chunksQueued] of pageChunkCounts) {
      this.logger.log(
        `Payment reminder page ${pageNumber} execution=${options.baseBatch.executionId} phase=${phase} chunksQueued=${chunksQueued}`,
      );
    }

    if (totalChunks > 0) {
      await this.queueService.setUnpaidReminderChunkTotal(
        options.baseBatch.executionId,
        phase,
        totalChunks,
      );

      const progress = await this.queueService.getUnpaidReminderChunkProgress(
        options.baseBatch.executionId,
        phase,
      );
      if (
        progress.done >= totalChunks &&
        (await this.queueService.tryClaimUnpaidPhaseFinalize(
          options.baseBatch.executionId,
          phase,
        ))
      ) {
        this.logger.log(
          `Unpaid ${phase} phase already fully processed during enqueue (execution=${options.baseBatch.executionId}); finalizing`,
        );
        await this.finalizeUnpaidReminderPhaseAfterChunks(
          {
            ...options.baseBatch,
            customerIds: [],
            recipients: [],
            chunkIndex: totalChunks - 1,
            totalChunks,
          },
          phase,
          [],
        );
      }
    }

    return { totalChunks, firstQueueJobId };
  }

  private async enqueuePrepaidOfferBatch(
    automation: Automation,
    options: { skipIfNoRecipients: boolean },
  ): Promise<StartAutomationExecutionResponseDto | null> {
    if (automation.purpose !== AutomationPurpose.FUNNEL_PAYMENT) {
      throw new BadRequestException(
        'Only Prepaid Offer automations can use the paid recipient batch',
      );
    }
    if (!automation.funnelId) {
      throw new BadRequestException('Automation has no funnel linked');
    }

    const paidCount = await this.recipientsService.countPaidCustomersForFunnel(
      automation.funnelId,
    );
    if (paidCount === 0) {
      if (options.skipIfNoRecipients) {
        return null;
      }
      throw new BadRequestException(
        'No paid customers found for this funnel',
      );
    }

    const startNodeId = await this.executionService.resolveStartNodeId(
      automation.id,
    );
    if (!startNodeId) {
      throw new BadRequestException(
        'Prepaid Offer flow has no start node configured',
      );
    }

    const startNode = await this.executionService.findNodeForAutomation(
      automation.id,
      startNodeId,
    );

    const predictedTotalChunks = predictSendChunkCount(
      paidCount,
      AUTOMATION_SEND_CHUNK_SIZE,
    );

    this.logger.log(
      `[Prepaid Offer] Batch enqueue start automation=${automation.id} funnel=${automation.funnelId} paid=${paidCount} pageSize=${AUTOMATION_RECIPIENT_PAGE_SIZE} chunkSize=${AUTOMATION_SEND_CHUNK_SIZE} predictedChunks=${predictedTotalChunks}`,
    );

    let started = 0;
    let firstExecutionId: number | null = null;
    let skipped = 0;

    const { totalChunks } = await forEachRecipientPageChunks({
      pageSize: AUTOMATION_RECIPIENT_PAGE_SIZE,
      chunkSize: AUTOMATION_SEND_CHUNK_SIZE,
      fetchPage: (afterCustomerId, limit) =>
        this.recipientsService.getPaidCustomersForFunnelPage(
          automation.funnelId!,
          { afterCustomerId, limit },
        ),
      onChunk: async (chunk, meta) => {
        this.logger.log(
          `[Prepaid Offer] Processing chunk ${meta.chunkIndex + 1}/${predictedTotalChunks} page=${meta.pageNumber} guests=${chunk.length}`,
        );

        for (const recipient of chunk) {
          const customerId = recipient.customerId;
          if (customerId == null || customerId <= 0) {
            continue;
          }

          const hasActive = await this.executionService.hasActiveExecution(
            automation.id,
            customerId,
          );
          if (hasActive) {
            skipped += 1;
            continue;
          }
          const hasCompleted =
            await this.executionService.hasCompletedExecutionForCustomer(
              automation.id,
              customerId,
            );
          if (hasCompleted) {
            skipped += 1;
            continue;
          }

          const execution = await this.executionService.createExecution(
            {
              automationId: automation.id,
              currentNodeId: startNodeId,
              purpose: automation.purpose,
            },
            customerId,
          );

          await this.queueService.addProcessExecution({
            executionId: execution.id,
            nodeId: startNodeId,
            nodeType: startNode.type,
          });

          if (firstExecutionId == null) {
            firstExecutionId = execution.id;
          }
          started += 1;
        }
      },
    });

    this.logger.log(
      `[Prepaid Offer] Batch enqueue done automation=${automation.id} chunks=${totalChunks} started=${started} skipped=${skipped}`,
    );

    if (started === 0 || firstExecutionId == null) {
      if (options.skipIfNoRecipients) {
        return null;
      }
      throw new BadRequestException(
        'No eligible paid customers to start (all already have a prepaid journey)',
      );
    }

    await this.logService.createLog({
      executionId: firstExecutionId,
      nodeId: startNodeId,
      customerId: (
        await this.executionService.findById(firstExecutionId)
      ).customerId,
      message: `Prepaid Offer batch: started ${started} journey(s) from ${paidCount} paid guest(s) using pages of ${AUTOMATION_RECIPIENT_PAGE_SIZE} and chunks of ${AUTOMATION_SEND_CHUNK_SIZE} (${totalChunks} chunk(s), skipped ${skipped})`,
    });

    return {
      status: await this.getExecutionStatus(firstExecutionId),
    };
  }

  async runUnpaidReminderBatch(batch: UnpaidReminderBatchJob): Promise<void> {
    const batchPhase = batch.batchPhase ?? 'payment';
    const chunkIndex = batch.chunkIndex ?? 0;
    const totalChunks = Math.max(1, batch.totalChunks ?? 1);
    const execution = await this.executionService.findById(batch.executionId);

    if (this.executionService.isTerminalExecutionStatus(execution.status)) {
      this.logger.log(
        `Skipping stale ${batchPhase} chunk ${chunkIndex}/${totalChunks} for terminal execution ${batch.executionId} (status=${execution.status})`,
      );
      return;
    }

    if (
      !execution.automation?.isActive ||
      !execution.automation.published
    ) {
      this.logger.log(
        `Skipping ${batchPhase} chunk for inactive/unpublished automation ${batch.automationId}`,
      );
      return;
    }

    const customerIds =
      batch.customerIds?.length && batch.customerIds.length > 0
        ? batch.customerIds
        : batch.recipients
            .map((recipient) => recipient.customerId)
            .filter((id): id is number => id != null && id > 0);

    batch.recipients =
      await this.recipientsService.getCustomersByIds(customerIds);

    this.logger.log(
      `Payment reminder ${batchPhase} chunk ${chunkIndex + 1}/${totalChunks} start execution=${batch.executionId} queuedIds=${customerIds.length} hydrated=${batch.recipients.length}`,
    );

    const actionNode = batch.plan.emailNode ?? batch.plan.smsNode;
    const isSmsBatch = Boolean(batch.plan.smsNode && !batch.plan.emailNode);
    const sendAsEmail =
      Boolean(batch.prepared) &&
      (batch.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER ||
        batch.purpose === AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER ||
        Boolean(batch.plan.emailNode));

    const firstCustomerId =
      batch.recipients[0]?.customerId ?? customerIds[0] ?? execution.customerId;
    if (firstCustomerId == null) {
      await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
        sent: [],
        allowEmptySent: true,
      });
      return;
    }

    const automationName =
      execution.automation?.name?.trim() ||
      `Automation #${batch.automationId}`;
    const campaignName =
      execution.automation?.campaign?.campaignName?.trim() || null;
    const funnelId =
      execution.automation?.funnelId ?? batch.funnelId ?? null;
    const funnelName =
      campaignName || (funnelId != null ? `Funnel #${funnelId}` : null);

    if (batchPhase === 'pass') {
      const beforeFilterCount = batch.recipients.length;
      batch.recipients =
        await this.recipientsService.filterStillUnpaidRecipients(
          batch.funnelId,
          batch.recipients,
        );
      const paidDuringWait = Math.max(
        0,
        beforeFilterCount - batch.recipients.length,
      );
      if (paidDuringWait > 0) {
        void this.observabilityService.incrementMetrics(batch.executionId, {
          recipientsPaidDuringWait: paidDuringWait,
          recipientsFiltered: paidDuringWait,
          recipientsSkipped: paidDuringWait,
        });
      }

      if (batch.recipients.length === 0) {
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          customerId: firstCustomerId,
          message:
            'QR pass email skipped — all recipients completed payment during wait',
        });
        await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
          sent: [],
          allowEmptySent: true,
        });
        return;
      }
    } else if (batchPhase === 'wallet') {
      const beforeUnpaidCount = batch.recipients.length;
      batch.recipients =
        await this.recipientsService.filterStillUnpaidRecipients(
          batch.funnelId,
          batch.recipients,
        );
      const paidFiltered = Math.max(
        0,
        beforeUnpaidCount - batch.recipients.length,
      );
      if (paidFiltered > 0) {
        void this.observabilityService.incrementMetrics(batch.executionId, {
          recipientsFiltered: paidFiltered,
          recipientsSkipped: paidFiltered,
        });
      }

      const beforeWalletCount = batch.recipients.length;
      batch.recipients = await this.filterRecipientsWithoutGoogleWalletPass(
        batch.funnelId,
        batch.recipients,
      );
      const walletAlreadyAdded = Math.max(
        0,
        beforeWalletCount - batch.recipients.length,
      );
      if (walletAlreadyAdded > 0) {
        void this.observabilityService.incrementMetrics(batch.executionId, {
          recipientsFiltered: walletAlreadyAdded,
          recipientsSkipped: walletAlreadyAdded,
        });
      }

      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.walletFilterNodeId ?? batch.emailNodeId,
        customerId: firstCustomerId,
        message: `Pass-added filter checked — ${batch.recipients.length} guest(s) still missing Google Wallet (skipped ${walletAlreadyAdded} already added). Next: send wallet reminder email.`,
      });
      this.logger.log(
        `Payment reminder wallet filter execution=${batch.executionId} remaining=${batch.recipients.length} skippedAdded=${walletAlreadyAdded} next=wallet_email`,
      );

      if (batch.recipients.length === 0) {
        await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
          sent: [],
          allowEmptySent: true,
        });
        return;
      }

      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.emailNodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );
    } else if (batchPhase === 'expiry') {
      const beforeUnpaidCount = batch.recipients.length;
      batch.recipients =
        await this.recipientsService.filterStillUnpaidRecipients(
          batch.funnelId,
          batch.recipients,
        );
      const paidFiltered = Math.max(
        0,
        beforeUnpaidCount - batch.recipients.length,
      );
      if (paidFiltered > 0) {
        void this.observabilityService.incrementMetrics(batch.executionId, {
          recipientsFiltered: paidFiltered,
          recipientsSkipped: paidFiltered,
        });
      }

      const beforeExpiryCount = batch.recipients.length;
      const amount = batch.expiryWithinAmount ?? 3;
      const unit = batch.expiryWithinUnit ?? 'days';
      batch.recipients = await this.filterRecipientsOfferExpiresWithin(
        batch.funnelId,
        batch.recipients,
        amount,
        unit,
      );
      const skippedNotExpiring = Math.max(
        0,
        beforeExpiryCount - batch.recipients.length,
      );
      if (skippedNotExpiring > 0) {
        void this.observabilityService.incrementMetrics(batch.executionId, {
          recipientsFiltered: skippedNotExpiring,
          recipientsSkipped: skippedNotExpiring,
        });
      }

      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.expiryFilterNodeId ?? batch.emailNodeId,
        customerId: firstCustomerId,
        message: `Offer-expiry filter checked (within ${amount} ${unit}) — ${batch.recipients.length} guest(s) match (skipped ${skippedNotExpiring}). Next: send expiry reminder email.`,
      });
      this.logger.log(
        `Payment reminder expiry filter execution=${batch.executionId} remaining=${batch.recipients.length} skipped=${skippedNotExpiring} window=${amount}${unit}`,
      );

      if (batch.recipients.length === 0) {
        await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
          sent: [],
          allowEmptySent: true,
        });
        return;
      }

      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.emailNodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );
    } else {
      const beforeFilterCount = batch.recipients.length;
      batch.recipients =
        await this.recipientsService.filterStillUnpaidRecipients(
          batch.funnelId,
          batch.recipients,
        );
      const filtered = Math.max(0, beforeFilterCount - batch.recipients.length);
      if (filtered > 0) {
        void this.observabilityService.incrementMetrics(batch.executionId, {
          recipientsFiltered: filtered,
          recipientsSkipped: filtered,
        });
      }
    }

    const lockedRecipients: EmailRecipient[] = [];
    const lockSkipped: EmailRecipient[] = [];
    const sendActionType =
      batchPhase === 'pass'
        ? PAYMENT_REMINDER_PASS_ACTION
        : batchPhase === 'wallet'
          ? PAYMENT_REMINDER_WALLET_ACTION
          : batchPhase === 'expiry'
            ? PAYMENT_REMINDER_EXPIRY_ACTION
            : PAYMENT_REMINDER_EMAIL_ACTION;
    for (const recipient of batch.recipients) {
      if (recipient.customerId == null) {
        continue;
      }
      if (
        batch.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER
      ) {
        const claimed = await this.sendAttemptService.tryClaim({
          automationId: batch.automationId,
          customerId: recipient.customerId,
          actionType: sendActionType,
          attempt: batch.executionId,
          executionId: batch.executionId,
        });
        if (!claimed) {
          lockSkipped.push(recipient);
          continue;
        }
      }
      const acquired = await this.queueService.tryAcquireUnpaidReminderSendLock(
        batch.funnelId,
        recipient.customerId,
        batch.executionId,
        batchPhase,
      );
      if (acquired) {
        lockedRecipients.push(recipient);
      } else {
        lockSkipped.push(recipient);
      }
    }
    if (lockSkipped.length > 0) {
      void this.observabilityService.recordRecipients(
        lockSkipped
          .filter((row) => row.customerId != null)
          .map((row) => ({
            executionId: batch.executionId,
            customerId: row.customerId!,
            nodeId: batch.emailNodeId,
            phase: batchPhase,
            status: AutomationRecipientDeliveryStatus.LOCK_SKIPPED,
            reason: 'Send lock already held for this execution phase',
          })),
      );
      void this.observabilityService.incrementMetrics(batch.executionId, {
        recipientsSkipped: lockSkipped.length,
      });
    }
    batch.recipients = lockedRecipients;

    if (batch.recipients.length === 0) {
      await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
        sent: [],
        allowEmptySent: true,
      });
      return;
    }

    await this.executionService.markProcessing(batch.executionId);

    const stepKey = this.unpaidReminderStepKey(batchPhase);
    const stepLabel =
      batchPhase === 'pass'
        ? 'Pass Email'
        : batchPhase === 'wallet'
          ? 'Wallet Reminder Email'
          : batchPhase === 'expiry'
            ? 'Offer Expiry Email'
            : 'Payment Email';
    void this.observabilityService.startStep({
      executionId: batch.executionId,
      stepKey,
      stepLabel,
      nodeId: batch.emailNodeId,
      phase: batchPhase,
      recipientsTotal: batch.recipients.length,
    });

    if (batchPhase === 'payment' && chunkIndex === 0) {
      if (batch.anchorStepOnTrigger) {
        await this.executionService.updateCurrentNode(
          batch.executionId,
          batch.plan.startNodeId,
        );
        this.logger.log(
          `Payment reminder advancing from cron node execution=${batch.executionId} node=${batch.plan.startNodeId}`,
        );
        this.logger.log(
          `${AutomationService.PAYMENT_REMINDER_CRON_LOG} CRON NODE DONE execution=${batch.executionId} cronNodeId=${batch.plan.startNodeId} next=condition_or_payment_email`,
        );
      }

      if (batch.plan.conditionNode) {
        await this.executionService.updateCurrentNode(
          batch.executionId,
          batch.plan.conditionNode.id,
        );
      }

      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.emailNodeId,
      );
    }

    if (batchPhase === 'pass' && batch.waitBeforePassNodeId && chunkIndex === 0) {
      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.waitBeforePassNodeId,
      );
      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.emailNodeId,
      );
    }

    if (batchPhase === 'wallet' && chunkIndex === 0) {
      if (batch.walletFilterNodeId) {
        await this.executionService.updateCurrentNode(
          batch.executionId,
          batch.walletFilterNodeId,
          AutomationExecutionStatus.RUNNING,
          null,
        );
        this.logger.log(
          `Payment reminder on pass-added filter execution=${batch.executionId} node=${batch.walletFilterNodeId}`,
        );
      }
      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.emailNodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );
      this.logger.log(
        `Payment reminder sending wallet reminder email execution=${batch.executionId} node=${batch.emailNodeId} subject="${batch.prepared?.subject ?? ''}"`,
      );
    }

    if (batchPhase === 'expiry' && chunkIndex === 0) {
      if (batch.expiryFilterNodeId) {
        await this.executionService.updateCurrentNode(
          batch.executionId,
          batch.expiryFilterNodeId,
          AutomationExecutionStatus.RUNNING,
          null,
        );
      }
      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.emailNodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );
      this.logger.log(
        `Payment reminder sending expiry email execution=${batch.executionId} node=${batch.emailNodeId} subject="${batch.prepared?.subject ?? ''}"`,
      );
    }

    const sent: { customerId: number; email: string }[] = [];
    const pathSummary = batch.plan.nodes
      .map((node) => `order ${node.order}:${node.type}`)
      .join(' → ');

    if (chunkIndex === 0) {
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.emailNodeId,
        customerId: firstCustomerId,
        message: isSmsBatch
          ? `Step 0 SMS node loaded. Flow: ${pathSummary}`
          : `Step 0 email node: subject "${batch.prepared?.subject ?? ''}" loaded. Flow: ${pathSummary}`,
      });

      if (batch.plan.conditionNode) {
        const conditionLabel = String(
          batch.plan.conditionNode.config?.conditionType ??
            batch.plan.conditionNode.config?.type ??
            'condition',
        );
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.conditionNodeId,
          customerId: firstCustomerId,
          message: `Step 1 condition: "${conditionLabel}" — sending unpaid reminders in chunks of ${AUTOMATION_SEND_CHUNK_SIZE}`,
        });
      }
    }

    await this.logService.createLog({
      executionId: batch.executionId,
      nodeId: batch.emailNodeId,
      customerId: firstCustomerId,
      message: `${this.unpaidReminderPhaseLabel(batchPhase)} reminder chunk ${chunkIndex + 1}/${totalChunks}: sending to ${batch.recipients.length} guest(s)`,
    });

    if (isSmsBatch && !sendAsEmail) {
      const smsMessage = String(actionNode?.config?.message ?? '').trim();

      for (const recipient of batch.recipients) {
        if (!recipient.customerId) {
          continue;
        }
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          customerId: recipient.customerId,
          message: `Payment reminder text sent to ${recipient.email} (bulk)`,
        });
        await this.chatMessageService.recordOutboundMessage({
          businessId: batch.businessId,
          customerId: recipient.customerId,
          automationId: batch.automationId,
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          channel: ConversationMessageChannel.SMS,
          bodyPreview: smsMessage || 'Text sent',
          idempotencyKey: `chat_message:execution:${batch.executionId}:node:${batch.emailNodeId}:customer:${recipient.customerId}:phase:${batchPhase}:sms`,
          metadata: {
            batchPhase,
            purpose: batch.purpose,
            channel: 'sms',
            automationName,
            campaignName,
            funnelId,
            funnelName,
          },
        });
        sent.push({
          customerId: recipient.customerId,
          email: recipient.email,
        });
      }

      if (sent.length > 0 && smsMessage) {
        await this.executionService.incrementEmailsSentBy(
          batch.executionId,
          sent.length,
        );
      }

      await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
        sent,
        allowEmptySent: true,
      });
      return;
    }

    try {
      const recipientTemplateOverrides = new Map<
        number,
        Partial<PreparedAutomationEmail['templateProps']>
      >();

      if (
        (batchPhase === 'payment' || batchPhase === 'expiry') &&
        batch.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER
      ) {
        for (const recipient of batch.recipients) {
          if (!recipient.customerId) {
            continue;
          }
          try {
            const issued = await this.checkoutResumeService.createSession({
              customerId: recipient.customerId,
              funnelId: batch.funnelId,
              businessId: batch.businessId,
              campaignId: batch.campaignId,
            });
            recipientTemplateOverrides.set(recipient.customerId, {
              ctaUrl: issued.checkoutUrl,
            });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Could not create checkout link';
            this.logger.warn(
              `Checkout link skipped for customer ${recipient.customerId}: ${message}`,
            );
          }
        }
      }

      if (batchPhase === 'pass' || batchPhase === 'wallet') {
        const passRecipients: EmailRecipient[] = [];
        for (const recipient of batch.recipients) {
          if (!recipient.customerId) {
            continue;
          }

          let coupon = await this.couponService.findByCustomerAndFunnel(
            recipient.customerId,
            batch.funnelId,
          );
          if (!coupon?.qrToken?.trim()) {
            coupon = await this.couponService.ensurePendingCouponForUnpaidFunnel(
              batch.funnelId,
              recipient.customerId,
            );
          }

          const token = coupon?.qrToken?.trim();
          if (!coupon || !token) {
            this.logger.warn(
              `${batchPhase} email skipped for customer ${recipient.customerId} — no coupon/QR token`,
            );
            continue;
          }

          const passUrl = buildGuestPassUrl(token);
          const offerName =
            coupon.campaign?.campaignName?.trim() || 'Dealioo offer';
          let businessName = 'Dealioo';
          if (batch.businessId) {
            const business = await this.businessRepository.findOne({
              where: { id: batch.businessId },
            });
            businessName = business?.name?.trim() || businessName;
          }

          let googleWalletSaveUrl: string | undefined;
          try {
            googleWalletSaveUrl = (
              await this.googleWalletService.createSaveLink({
                passId: String(coupon.id),
                offerName,
                businessName,
                qrOrRedemptionUrl: passUrl,
                qrToken: token,
              })
            ).saveUrl;
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Could not create Google Wallet save link';
            this.logger.warn(
              `Google Wallet save link skipped for customer ${recipient.customerId}: ${message}`,
            );
          }

          recipientTemplateOverrides.set(recipient.customerId, {
            ctaLabel: 'View my pass',
            ctaUrl: passUrl,
            ...(googleWalletSaveUrl ? { googleWalletSaveUrl } : {}),
          });
          passRecipients.push(recipient);
        }

        if (passRecipients.length === 0) {
          this.logger.warn(
            `Payment reminder ${batchPhase} chunk skipped execution=${batch.executionId} — no recipients with pass links`,
          );
          await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
            sent: [],
            allowEmptySent: true,
          });
          return;
        }

        batch.recipients = passRecipients;
      }

      const sendResult = await this.automationEmailService.sendBulkToRecipients(
        batch.purpose,
        batch.recipients,
        batch.prepared!,
        ['unpaid_reminder_batch'],
        recipientTemplateOverrides.size > 0
          ? recipientTemplateOverrides
          : undefined,
      );

      if (!sendResult.sent) {
        throw new Error(sendResult.error ?? 'Bulk email send failed');
      }

      const messagePreview =
        this.automationEmailService.resolvePreparedEmailPreview(batch.prepared!);

      for (const recipient of batch.recipients) {
        if (!recipient.customerId) {
          continue;
        }
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          customerId: recipient.customerId,
          message:
            batchPhase === 'pass'
              ? `QR pass email sent to ${recipient.email} (bulk)`
              : `Payment reminder email sent to ${recipient.email} (bulk)`,
        });
        await this.activityService.logMessageSent({
          businessId: batch.businessId,
          customerId: recipient.customerId,
          messagePreview,
          idempotencyKey: `message_sent:execution:${batch.executionId}:node:${batch.emailNodeId}:customer:${recipient.customerId}`,
          metadata: {
            automationExecutionId: batch.executionId,
            emailNodeId: batch.emailNodeId,
            purpose: batch.purpose,
          },
        });
        await this.chatMessageService.recordOutboundMessage({
          businessId: batch.businessId,
          customerId: recipient.customerId,
          automationId: batch.automationId,
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          channel: ConversationMessageChannel.EMAIL,
          bodyPreview:
            await this.automationEmailService.resolveRecipientChatMessageBody(
              batch.prepared!,
              recipient,
              batch.purpose,
              recipient.customerId != null
                ? recipientTemplateOverrides.get(recipient.customerId)
                : undefined,
            ),
          idempotencyKey: `chat_message:execution:${batch.executionId}:node:${batch.emailNodeId}:customer:${recipient.customerId}:phase:${batchPhase}`,
          metadata: {
            batchPhase,
            purpose: batch.purpose,
            automationExecutionId: batch.executionId,
            nodeId: batch.emailNodeId,
            automationName,
            campaignName,
            funnelId,
            funnelName,
          },
        });
        sent.push({
          customerId: recipient.customerId,
          email: recipient.email,
        });
      }

      void this.observabilityService.recordRecipients(
        sent.map((row) => ({
          executionId: batch.executionId,
          customerId: row.customerId,
          nodeId: batch.emailNodeId,
          phase: batchPhase,
          status: AutomationRecipientDeliveryStatus.SENT,
          reason:
            batchPhase === 'pass'
              ? 'QR pass email sent'
              : 'Payment reminder email sent',
        })),
      );
      void this.observabilityService.incrementMetrics(batch.executionId, {
        recipientsSent: sent.length,
        ...(batchPhase === 'pass' ? { passEmailsSent: sent.length } : {}),
      });

      await this.executionService.incrementEmailsSentBy(
        batch.executionId,
        sendResult.recipientCount,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Bulk email send failed';
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.emailNodeId,
        customerId: firstCustomerId,
        message: 'Bulk payment reminder send failed',
        error: message,
      });
      void this.observabilityService.completeStep({
        executionId: batch.executionId,
        stepKey: this.unpaidReminderStepKey(batchPhase),
        status: AutomationExecutionStepStatus.FAILED,
        error: message,
        recipientsFailed: batch.recipients.length,
      });
      void this.observabilityService.incrementMetrics(batch.executionId, {
        recipientsFailed: batch.recipients.length,
      });
      await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
        sent,
        allowEmptySent: true,
      });
      return;
    }

    await this.completeUnpaidReminderChunk(batch, batchPhase, totalChunks, {
      sent,
      allowEmptySent: true,
    });
  }

  private unpaidReminderPhaseLabel(
    batchPhase: UnpaidReminderBatchPhase,
  ): string {
    if (batchPhase === 'pass') return 'Pass';
    if (batchPhase === 'wallet') return 'Wallet';
    if (batchPhase === 'expiry') return 'Expiry';
    return 'Payment';
  }

  private unpaidReminderStepKey(
    batchPhase: UnpaidReminderBatchPhase,
  ): string {
    if (batchPhase === 'pass') return 'pass_email';
    if (batchPhase === 'wallet') return 'wallet_email';
    if (batchPhase === 'expiry') return 'expiry_email';
    return 'payment_email';
  }

  private async filterRecipientsWithoutGoogleWalletPass(
    funnelId: number,
    recipients: EmailRecipient[],
  ): Promise<EmailRecipient[]> {
    const kept: EmailRecipient[] = [];
    for (const recipient of recipients) {
      if (recipient.customerId == null) {
        continue;
      }
      const coupon = await this.couponService.findByCustomerAndFunnel(
        recipient.customerId,
        funnelId,
      );
      const alreadyAdded =
        coupon != null &&
        (coupon.googleWalletStatus === GoogleWalletStatus.ADDED ||
          coupon.googleWalletAdded === true);
      if (!alreadyAdded) {
        kept.push(recipient);
      }
    }
    return kept;
  }

  private async filterRecipientsOfferExpiresWithin(
    funnelId: number,
    recipients: EmailRecipient[],
    amount: number,
    unitRaw: string,
  ): Promise<EmailRecipient[]> {
    const unit = normalizeSignupDelayUnit(unitRaw) ?? 'days';
    const thresholdMs = signupDelayToMs(amount, unit);
    if (thresholdMs <= 0) {
      return [];
    }
    const kept: EmailRecipient[] = [];
    for (const recipient of recipients) {
      if (recipient.customerId == null) {
        continue;
      }
      const coupon = await this.couponService.findByCustomerAndFunnel(
        recipient.customerId,
        funnelId,
      );
      if (!coupon?.expiresAt) {
        continue;
      }
      const msLeft = coupon.expiresAt.getTime() - Date.now();
      if (msLeft > 0 && msLeft <= thresholdMs) {
        kept.push(recipient);
      }
    }
    return kept;
  }

  private async completeUnpaidReminderChunk(
    batch: UnpaidReminderBatchJob,
    batchPhase: UnpaidReminderBatchPhase,
    totalChunks: number,
    options: {
      sent: { customerId: number; email: string }[];
      allowEmptySent?: boolean;
    },
  ): Promise<void> {
    const chunkIndex = batch.chunkIndex ?? 0;
    const { done, total, isLast } =
      await this.queueService.recordUnpaidChunkCompleted(
        batch.executionId,
        batchPhase,
        totalChunks,
      );

    this.logger.log(
      `Payment reminder ${batchPhase} chunk ${chunkIndex + 1}/${total} done execution=${batch.executionId} sent=${options.sent.length} progress=${done}/${total}${isLast ? ' (last chunk)' : ''}`,
    );

    const logCustomerId =
      options.sent[0]?.customerId ??
      batch.recipients[0]?.customerId ??
      batch.customerIds?.[0];
    if (logCustomerId != null) {
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.emailNodeId,
        customerId: logCustomerId,
        message: `${this.unpaidReminderPhaseLabel(batchPhase)} reminder chunk ${chunkIndex + 1}/${total} finished (sent ${options.sent.length}, progress ${done}/${total})`,
      });
    }

    if (!isLast) {
      return;
    }

    await this.finalizeUnpaidReminderPhaseAfterChunks(
      batch,
      batchPhase,
      options.sent,
      options,
    );
  }

  private async finalizeUnpaidReminderPhaseAfterChunks(
    batch: UnpaidReminderBatchJob,
    batchPhase: UnpaidReminderBatchPhase,
    sent: { customerId: number; email: string }[],
    options?: {
      allowEmptySent?: boolean;
    },
  ): Promise<void> {
    if (
      batchPhase === 'payment' &&
      batch.passPrepared &&
      batch.passEmailNodeId
    ) {
      const logCustomerId =
        sent[0]?.customerId ??
        batch.recipients[0]?.customerId ??
        batch.customerIds?.[0];
      if (logCustomerId != null) {
        await this.schedulePassFollowUpIfNeeded(batch, logCustomerId);
      } else {
        await this.finishUnpaidReminderBatchExecution(batch, batchPhase, [], {
          allowEmptySent: true,
        });
      }
      return;
    }

    if (
      batchPhase === 'pass' &&
      batch.walletPrepared &&
      batch.walletEmailNodeId
    ) {
      const logCustomerId =
        sent[0]?.customerId ??
        batch.recipients[0]?.customerId ??
        batch.customerIds?.[0];
      if (logCustomerId != null) {
        await this.scheduleWalletReminderIfNeeded(batch, logCustomerId);
      } else {
        await this.finishUnpaidReminderBatchExecution(batch, batchPhase, [], {
          allowEmptySent: true,
        });
      }
      return;
    }

    if (
      batchPhase === 'wallet' &&
      batch.expiryPrepared &&
      batch.expiryEmailNodeId
    ) {
      const logCustomerId =
        sent[0]?.customerId ??
        batch.recipients[0]?.customerId ??
        batch.customerIds?.[0];
      if (logCustomerId != null) {
        await this.scheduleExpiryReminderIfNeeded(batch, logCustomerId);
      } else {
        await this.finishUnpaidReminderBatchExecution(batch, batchPhase, [], {
          allowEmptySent: true,
        });
      }
      return;
    }

    await this.finishUnpaidReminderBatchExecution(batch, batchPhase, sent, {
      allowEmptySent: options?.allowEmptySent,
    });
  }

  private async schedulePassFollowUpIfNeeded(
    batch: UnpaidReminderBatchJob,
    customerId: number,
  ): Promise<void> {
    if (!batch.passPrepared || !batch.passEmailNodeId) {
      return;
    }

    const execution = await this.executionService.findById(batch.executionId);
    if (this.executionService.isTerminalExecutionStatus(execution.status)) {
      return;
    }

    if (await this.logService.hasPassFollowUpScheduled(batch.executionId)) {
      if (execution.status === AutomationExecutionStatus.WAITING) {
        return;
      }

      const waitNodeId = batch.waitBeforePassNodeId ?? batch.passEmailNodeId;
      if ((batch.waitDelayMs ?? 0) > 0) {
        await this.executionService.updateExecutionContext(batch.executionId, {
          ...(execution.executionContext ?? {}),
          paymentReminderResume: 'pass_after_wait',
        });
      }
      await this.executionService.updateCurrentNode(
        batch.executionId,
        waitNodeId,
        AutomationExecutionStatus.WAITING,
        batch.waitDelayMs && batch.waitDelayMs > 0
          ? new Date(Date.now() + batch.waitDelayMs)
          : null,
      );
      return;
    }

    const waitMinutes = Math.round((batch.waitDelayMs ?? 0) / 60_000);
    await this.logService.createLog({
      executionId: batch.executionId,
      nodeId: batch.waitBeforePassNodeId ?? batch.passEmailNodeId,
      customerId,
      message:
        waitMinutes > 0
          ? `Wait ${waitMinutes} minute(s) before sending QR pass email`
          : 'Scheduling QR pass email',
    });

    const unpaidCount =
      await this.recipientsService.countUnpaidCustomersForFunnel(batch.funnelId);
    if (unpaidCount === 0) {
      await this.finishUnpaidReminderBatchExecution(batch, 'pass', [], {
        allowEmptySent: true,
      });
      return;
    }

    const waitDelayMs = batch.waitDelayMs ?? 0;
    if (waitDelayMs > 0) {
      const waitNodeId = batch.waitBeforePassNodeId ?? batch.passEmailNodeId;
      await this.executionService.updateExecutionContext(batch.executionId, {
        ...(execution.executionContext ?? {}),
        paymentReminderResume: 'pass_after_wait',
      });
      await this.executionService.updateCurrentNode(
        batch.executionId,
        waitNodeId,
        AutomationExecutionStatus.WAITING,
        new Date(Date.now() + waitDelayMs),
      );
      void this.observabilityService.onWaiting({
        executionId: batch.executionId,
        nodeId: waitNodeId,
        waitDelayMs,
      });
      void this.observabilityService.completeStep({
        executionId: batch.executionId,
        stepKey: 'payment_email',
        status: AutomationExecutionStepStatus.COMPLETED,
      });
      return;
    }

    await this.enqueuePaymentReminderPassPhase(batch);
  }

  async resumePaymentReminderAfterWait(executionId: number): Promise<void> {
    const execution = await this.executionService.findById(executionId);
    if (execution.status === AutomationExecutionStatus.PAUSED) {
      return;
    }
    if (execution.status !== AutomationExecutionStatus.WAITING) {
      return;
    }

    const automation = execution.automation;
    if (!automation?.isActive || !automation.published) {
      await this.executionService.pauseExecution(executionId);
      return;
    }
    if (!automation.funnelId) {
      await this.executionService.markFailed(
        executionId,
        'Automation has no funnel linked',
      );
      return;
    }

    const waitNodeId = execution.currentNodeId;
    await this.logService.createLog({
      executionId,
      nodeId: waitNodeId,
      customerId: execution.customerId,
      message: 'Wait completed',
    });

    const resume =
      execution.executionContext?.paymentReminderResume ?? 'pass_after_wait';

    try {
      if (resume === 'expiry_after_wait') {
        await this.enqueuePaymentReminderExpiryPhaseFromExecution(
          execution,
          automation,
        );
      } else if (resume === 'wallet_after_wait') {
        await this.enqueuePaymentReminderWalletPhaseFromExecution(
          execution,
          automation,
        );
      } else {
        await this.enqueuePaymentReminderPassPhaseFromExecution(
          execution,
          automation,
        );
      }
    } catch (error) {
      await this.executionService.updateCurrentNode(
        executionId,
        waitNodeId,
        AutomationExecutionStatus.WAITING,
        new Date(),
      );
      throw error;
    }
  }

  private async enqueuePaymentReminderPassPhaseFromExecution(
    execution: AutomationExecution,
    automation: Automation,
  ): Promise<void> {
    const plan = await this.flowService.buildExecutionPlan(automation.id);
    if (!plan.passEmailNode) {
      await this.executionService.markCompleted(execution.id);
      return;
    }

    const campaignName =
      automation.campaign?.campaignName?.trim() || 'the campaign';
    const passPrepared = this.automationEmailService.prepareFromActionNode(
      plan.passEmailNode,
      automation.purpose,
      { requireSubject: false, campaignName },
    );
    if (!String(passPrepared.templateProps.ctaLabel ?? '').trim()) {
      passPrepared.templateProps.ctaLabel = 'View my pass';
    }

    let walletPrepared: PreparedAutomationEmail | null = null;
    let waitBeforeWalletDelayMs = 0;
    if (plan.walletEmailNode) {
      walletPrepared = this.automationEmailService.prepareFromActionNode(
        plan.walletEmailNode,
        automation.purpose,
        { requireSubject: false, campaignName },
      );
      if (!String(walletPrepared.templateProps.ctaLabel ?? '').trim()) {
        walletPrepared.templateProps.ctaLabel = 'View my pass';
      }
      if (plan.waitBeforeWalletNode) {
        waitBeforeWalletDelayMs =
          resolveWaitDelayMinutes(plan.waitBeforeWalletNode.config ?? {}) *
          60_000;
      }
    }

    await this.enqueuePaymentReminderPassPhase({
      executionId: execution.id,
      automationId: automation.id,
      businessId: automation.businessId,
      funnelId: automation.funnelId!,
      campaignId: automation.campaignId ?? automation.campaign?.id ?? null,
      emailNodeId: plan.passEmailNode.id,
      conditionNodeId: plan.conditionNode?.id ?? plan.passEmailNode.id,
      purpose: automation.purpose,
      prepared: passPrepared,
      plan,
      recipients: [],
      anchorStepOnTrigger: true,
      batchPhase: 'pass',
      passPrepared,
      passEmailNodeId: plan.passEmailNode.id,
      waitBeforePassNodeId: plan.waitBeforePassNode?.id ?? null,
      waitDelayMs: 0,
      walletPrepared,
      walletEmailNodeId: plan.walletEmailNode?.id ?? null,
      waitBeforeWalletNodeId: plan.waitBeforeWalletNode?.id ?? null,
      waitBeforeWalletDelayMs,
      walletFilterNodeId: plan.walletFilterNode?.id ?? null,
    });
  }

  private async enqueuePaymentReminderPassPhase(
    batch: Omit<
      UnpaidReminderBatchJob,
      'customerIds' | 'chunkIndex' | 'totalChunks'
    >,
  ): Promise<void> {
    if (!batch.passPrepared || !batch.passEmailNodeId) {
      return;
    }

    const unpaidCount =
      await this.recipientsService.countUnpaidCustomersForFunnel(batch.funnelId);
    if (unpaidCount === 0) {
      await this.finishUnpaidReminderBatchExecution(
        batch as UnpaidReminderBatchJob,
        'pass',
        [],
        { allowEmptySent: true },
      );
      return;
    }

    const passBase: Omit<
      UnpaidReminderBatchJob,
      'customerIds' | 'recipients' | 'chunkIndex' | 'totalChunks'
    > = {
      executionId: batch.executionId,
      automationId: batch.automationId,
      businessId: batch.businessId,
      funnelId: batch.funnelId,
      campaignId: batch.campaignId,
      emailNodeId: batch.passEmailNodeId,
      conditionNodeId: batch.conditionNodeId,
      purpose: batch.purpose,
      prepared: batch.passPrepared,
      plan: batch.plan,
      anchorStepOnTrigger: batch.anchorStepOnTrigger,
      batchPhase: 'pass',
      passPrepared: batch.passPrepared,
      passEmailNodeId: batch.passEmailNodeId,
      waitBeforePassNodeId: batch.waitBeforePassNodeId,
      waitDelayMs: 0,
      walletPrepared: batch.walletPrepared ?? null,
      walletEmailNodeId: batch.walletEmailNodeId ?? null,
      waitBeforeWalletNodeId: batch.waitBeforeWalletNodeId ?? null,
      waitBeforeWalletDelayMs: batch.waitBeforeWalletDelayMs ?? 0,
      walletFilterNodeId: batch.walletFilterNodeId ?? null,
      expiryPrepared: batch.expiryPrepared ?? null,
      expiryEmailNodeId: batch.expiryEmailNodeId ?? null,
      waitBeforeExpiryNodeId: batch.waitBeforeExpiryNodeId ?? null,
      waitBeforeExpiryDelayMs: batch.waitBeforeExpiryDelayMs ?? 0,
      expiryFilterNodeId: batch.expiryFilterNodeId ?? null,
      expiryWithinAmount: batch.expiryWithinAmount ?? null,
      expiryWithinUnit: batch.expiryWithinUnit ?? null,
    };

    const { totalChunks } = await this.enqueueUnpaidReminderChunksFromPages({
      funnelId: batch.funnelId,
      baseBatch: passBase,
      delayMs: 0,
      predictedTotalChunks: predictSendChunkCount(
        unpaidCount,
        AUTOMATION_SEND_CHUNK_SIZE,
      ),
    });

    if (totalChunks === 0) {
      await this.finishUnpaidReminderBatchExecution(
        batch as UnpaidReminderBatchJob,
        'pass',
        [],
        { allowEmptySent: true },
      );
      return;
    }

    const waitNodeId = batch.waitBeforePassNodeId ?? batch.passEmailNodeId;
    await this.executionService.updateCurrentNode(
      batch.executionId,
      waitNodeId,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    void this.observabilityService.completeStep({
      executionId: batch.executionId,
      stepKey: 'payment_email',
      status: AutomationExecutionStepStatus.COMPLETED,
    });
  }

  private async scheduleWalletReminderIfNeeded(
    batch: UnpaidReminderBatchJob,
    customerId: number,
  ): Promise<void> {
    if (!batch.walletPrepared || !batch.walletEmailNodeId) {
      await this.finishUnpaidReminderBatchExecution(batch, 'pass', [], {
        allowEmptySent: true,
      });
      return;
    }

    const execution = await this.executionService.findById(batch.executionId);
    if (this.executionService.isTerminalExecutionStatus(execution.status)) {
      return;
    }

    if (await this.logService.hasWalletFollowUpScheduled(batch.executionId)) {
      if (execution.status === AutomationExecutionStatus.WAITING) {
        return;
      }
      const waitNodeId =
        batch.waitBeforeWalletNodeId ??
        batch.walletFilterNodeId ??
        batch.walletEmailNodeId;
      if ((batch.waitBeforeWalletDelayMs ?? 0) > 0) {
        await this.executionService.updateExecutionContext(batch.executionId, {
          ...(execution.executionContext ?? {}),
          paymentReminderResume: 'wallet_after_wait',
        });
      }
      await this.executionService.updateCurrentNode(
        batch.executionId,
        waitNodeId,
        AutomationExecutionStatus.WAITING,
        batch.waitBeforeWalletDelayMs && batch.waitBeforeWalletDelayMs > 0
          ? new Date(Date.now() + batch.waitBeforeWalletDelayMs)
          : null,
      );
      return;
    }

    const waitDelayMs = batch.waitBeforeWalletDelayMs ?? 0;
    const waitMinutes = Math.round(waitDelayMs / 60_000);
    await this.logService.createLog({
      executionId: batch.executionId,
      nodeId:
        batch.waitBeforeWalletNodeId ??
        batch.walletFilterNodeId ??
        batch.walletEmailNodeId,
      customerId,
      message:
        waitMinutes > 0
          ? `Wait ${waitMinutes} minute(s) before checking Google Wallet / sending wallet reminder`
          : 'Scheduling wallet reminder email',
    });

    if (waitDelayMs > 0) {
      const waitNodeId =
        batch.waitBeforeWalletNodeId ??
        batch.walletFilterNodeId ??
        batch.walletEmailNodeId;
      await this.executionService.updateExecutionContext(batch.executionId, {
        ...(execution.executionContext ?? {}),
        paymentReminderResume: 'wallet_after_wait',
      });
      await this.executionService.updateCurrentNode(
        batch.executionId,
        waitNodeId,
        AutomationExecutionStatus.WAITING,
        new Date(Date.now() + waitDelayMs),
      );
      void this.observabilityService.onWaiting({
        executionId: batch.executionId,
        nodeId: waitNodeId,
        waitDelayMs,
      });
      void this.observabilityService.completeStep({
        executionId: batch.executionId,
        stepKey: 'pass_email',
        status: AutomationExecutionStepStatus.COMPLETED,
      });
      return;
    }

    await this.enqueuePaymentReminderWalletPhase(batch);
  }

  private async enqueuePaymentReminderWalletPhaseFromExecution(
    execution: AutomationExecution,
    automation: Automation,
  ): Promise<void> {
    const plan = await this.flowService.buildExecutionPlan(automation.id);
    if (!plan.walletEmailNode) {
      await this.executionService.markCompleted(execution.id);
      return;
    }

    const campaignName =
      automation.campaign?.campaignName?.trim() || 'the campaign';
    const walletPrepared = this.automationEmailService.prepareFromActionNode(
      plan.walletEmailNode,
      automation.purpose,
      { requireSubject: false, campaignName },
    );
    if (!String(walletPrepared.templateProps.ctaLabel ?? '').trim()) {
      walletPrepared.templateProps.ctaLabel = 'View my pass';
    }

    let passPrepared: PreparedAutomationEmail | null = null;
    if (plan.passEmailNode) {
      passPrepared = this.automationEmailService.prepareFromActionNode(
        plan.passEmailNode,
        automation.purpose,
        { requireSubject: false, campaignName },
      );
    }

    await this.enqueuePaymentReminderWalletPhase({
      executionId: execution.id,
      automationId: automation.id,
      businessId: automation.businessId,
      funnelId: automation.funnelId!,
      campaignId: automation.campaignId ?? automation.campaign?.id ?? null,
      emailNodeId: plan.walletEmailNode.id,
      conditionNodeId:
        plan.walletFilterNode?.id ??
        plan.conditionNode?.id ??
        plan.walletEmailNode.id,
      purpose: automation.purpose,
      prepared: walletPrepared,
      plan,
      recipients: [],
      anchorStepOnTrigger: true,
      batchPhase: 'wallet',
      passPrepared,
      passEmailNodeId: plan.passEmailNode?.id ?? null,
      waitBeforePassNodeId: plan.waitBeforePassNode?.id ?? null,
      waitDelayMs: 0,
      walletPrepared,
      walletEmailNodeId: plan.walletEmailNode.id,
      waitBeforeWalletNodeId: plan.waitBeforeWalletNode?.id ?? null,
      waitBeforeWalletDelayMs: 0,
      walletFilterNodeId: plan.walletFilterNode?.id ?? null,
      expiryPrepared: (() => {
        if (!plan.expiryEmailNode) return null;
        const prepared = this.automationEmailService.prepareFromActionNode(
          plan.expiryEmailNode,
          automation.purpose,
          { requireSubject: false, campaignName },
        );
        if (!String(prepared.templateProps.ctaLabel ?? '').trim()) {
          prepared.templateProps.ctaLabel = 'Complete payment';
        }
        return prepared;
      })(),
      expiryEmailNodeId: plan.expiryEmailNode?.id ?? null,
      waitBeforeExpiryNodeId: plan.waitBeforeExpiryNode?.id ?? null,
      waitBeforeExpiryDelayMs: plan.waitBeforeExpiryNode
        ? resolveWaitDelayMinutes(plan.waitBeforeExpiryNode.config ?? {}) * 60_000
        : 0,
      expiryFilterNodeId: plan.expiryFilterNode?.id ?? null,
      expiryWithinAmount: plan.expiryFilterNode
        ? this.flowService.parseOfferExpiresWithin(
            plan.expiryFilterNode.config ?? {},
          )?.amount ?? 3
        : null,
      expiryWithinUnit: plan.expiryFilterNode
        ? this.flowService.parseOfferExpiresWithin(
            plan.expiryFilterNode.config ?? {},
          )?.unit ?? 'days'
        : null,
    });
  }

  private async enqueuePaymentReminderWalletPhase(
    batch: Omit<
      UnpaidReminderBatchJob,
      'customerIds' | 'chunkIndex' | 'totalChunks'
    >,
  ): Promise<void> {
    if (!batch.walletPrepared || !batch.walletEmailNodeId) {
      await this.finishUnpaidReminderBatchExecution(
        batch as UnpaidReminderBatchJob,
        'pass',
        [],
        { allowEmptySent: true },
      );
      return;
    }

    const unpaidCount =
      await this.recipientsService.countUnpaidCustomersForFunnel(batch.funnelId);
    if (unpaidCount === 0) {
      await this.finishUnpaidReminderBatchExecution(
        batch as UnpaidReminderBatchJob,
        'wallet',
        [],
        { allowEmptySent: true },
      );
      return;
    }

    const walletBase: Omit<
      UnpaidReminderBatchJob,
      'customerIds' | 'recipients' | 'chunkIndex' | 'totalChunks'
    > = {
      executionId: batch.executionId,
      automationId: batch.automationId,
      businessId: batch.businessId,
      funnelId: batch.funnelId,
      campaignId: batch.campaignId,
      emailNodeId: batch.walletEmailNodeId,
      conditionNodeId:
        batch.walletFilterNodeId ?? batch.conditionNodeId,
      purpose: batch.purpose,
      prepared: batch.walletPrepared,
      plan: batch.plan,
      anchorStepOnTrigger: batch.anchorStepOnTrigger,
      batchPhase: 'wallet',
      passPrepared: batch.passPrepared,
      passEmailNodeId: batch.passEmailNodeId,
      waitBeforePassNodeId: batch.waitBeforePassNodeId,
      waitDelayMs: 0,
      walletPrepared: batch.walletPrepared,
      walletEmailNodeId: batch.walletEmailNodeId,
      waitBeforeWalletNodeId: batch.waitBeforeWalletNodeId ?? null,
      waitBeforeWalletDelayMs: 0,
      walletFilterNodeId: batch.walletFilterNodeId,
      expiryPrepared: batch.expiryPrepared ?? null,
      expiryEmailNodeId: batch.expiryEmailNodeId ?? null,
      waitBeforeExpiryNodeId: batch.waitBeforeExpiryNodeId ?? null,
      waitBeforeExpiryDelayMs: batch.waitBeforeExpiryDelayMs ?? 0,
      expiryFilterNodeId: batch.expiryFilterNodeId ?? null,
      expiryWithinAmount: batch.expiryWithinAmount ?? null,
      expiryWithinUnit: batch.expiryWithinUnit ?? null,
    };

    const { totalChunks } = await this.enqueueUnpaidReminderChunksFromPages({
      funnelId: batch.funnelId,
      baseBatch: walletBase,
      delayMs: 0,
      predictedTotalChunks: predictSendChunkCount(
        unpaidCount,
        AUTOMATION_SEND_CHUNK_SIZE,
      ),
    });

    if (totalChunks === 0) {
      await this.finishUnpaidReminderBatchExecution(
        batch as UnpaidReminderBatchJob,
        'wallet',
        [],
        { allowEmptySent: true },
      );
      return;
    }

    await this.executionService.updateCurrentNode(
      batch.executionId,
      batch.walletEmailNodeId,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    void this.observabilityService.completeStep({
      executionId: batch.executionId,
      stepKey: 'pass_email',
      status: AutomationExecutionStepStatus.COMPLETED,
    });
    this.logger.log(
      `Payment reminder wallet phase queued execution=${batch.executionId} chunks=${totalChunks} emailNode=${batch.walletEmailNodeId}`,
    );
  }

  private async scheduleExpiryReminderIfNeeded(
    batch: UnpaidReminderBatchJob,
    customerId: number,
  ): Promise<void> {
    if (!batch.expiryPrepared || !batch.expiryEmailNodeId) {
      await this.finishUnpaidReminderBatchExecution(batch, 'wallet', [], {
        allowEmptySent: true,
      });
      return;
    }

    const execution = await this.executionService.findById(batch.executionId);
    if (this.executionService.isTerminalExecutionStatus(execution.status)) {
      return;
    }

    if (await this.logService.hasExpiryFollowUpScheduled(batch.executionId)) {
      if (execution.status === AutomationExecutionStatus.WAITING) {
        return;
      }
      const waitNodeId =
        batch.waitBeforeExpiryNodeId ??
        batch.expiryFilterNodeId ??
        batch.expiryEmailNodeId;
      if ((batch.waitBeforeExpiryDelayMs ?? 0) > 0) {
        await this.executionService.updateExecutionContext(batch.executionId, {
          ...(execution.executionContext ?? {}),
          paymentReminderResume: 'expiry_after_wait',
        });
      }
      await this.executionService.updateCurrentNode(
        batch.executionId,
        waitNodeId,
        AutomationExecutionStatus.WAITING,
        batch.waitBeforeExpiryDelayMs && batch.waitBeforeExpiryDelayMs > 0
          ? new Date(Date.now() + batch.waitBeforeExpiryDelayMs)
          : null,
      );
      return;
    }

    const waitDelayMs = batch.waitBeforeExpiryDelayMs ?? 0;
    const waitMinutes = Math.round(waitDelayMs / 60_000);
    await this.logService.createLog({
      executionId: batch.executionId,
      nodeId:
        batch.waitBeforeExpiryNodeId ??
        batch.expiryFilterNodeId ??
        batch.expiryEmailNodeId,
      customerId,
      message:
        waitMinutes > 0
          ? `Wait ${waitMinutes} minute(s) before checking offer expiry / sending expiry reminder`
          : 'Scheduling offer expiry reminder email',
    });

    if (waitDelayMs > 0) {
      const waitNodeId =
        batch.waitBeforeExpiryNodeId ??
        batch.expiryFilterNodeId ??
        batch.expiryEmailNodeId;
      await this.executionService.updateExecutionContext(batch.executionId, {
        ...(execution.executionContext ?? {}),
        paymentReminderResume: 'expiry_after_wait',
      });
      await this.executionService.updateCurrentNode(
        batch.executionId,
        waitNodeId,
        AutomationExecutionStatus.WAITING,
        new Date(Date.now() + waitDelayMs),
      );
      void this.observabilityService.onWaiting({
        executionId: batch.executionId,
        nodeId: waitNodeId,
        waitDelayMs,
      });
      void this.observabilityService.completeStep({
        executionId: batch.executionId,
        stepKey: 'wallet_email',
        status: AutomationExecutionStepStatus.COMPLETED,
      });
      return;
    }

    await this.enqueuePaymentReminderExpiryPhase(batch);
  }

  private async enqueuePaymentReminderExpiryPhaseFromExecution(
    execution: AutomationExecution,
    automation: Automation,
  ): Promise<void> {
    const plan = await this.flowService.buildExecutionPlan(automation.id);
    if (!plan.expiryEmailNode) {
      await this.executionService.markCompleted(execution.id);
      return;
    }

    const campaignName =
      automation.campaign?.campaignName?.trim() || 'the campaign';
    const expiryPrepared = this.automationEmailService.prepareFromActionNode(
      plan.expiryEmailNode,
      automation.purpose,
      { requireSubject: false, campaignName },
    );
    if (!String(expiryPrepared.templateProps.ctaLabel ?? '').trim()) {
      expiryPrepared.templateProps.ctaLabel = 'Complete payment';
    }
    const parsed = plan.expiryFilterNode
      ? this.flowService.parseOfferExpiresWithin(
          plan.expiryFilterNode.config ?? {},
        )
      : null;

    await this.enqueuePaymentReminderExpiryPhase({
      executionId: execution.id,
      automationId: automation.id,
      businessId: automation.businessId,
      funnelId: automation.funnelId!,
      campaignId: automation.campaignId ?? automation.campaign?.id ?? null,
      emailNodeId: plan.expiryEmailNode.id,
      conditionNodeId:
        plan.expiryFilterNode?.id ??
        plan.conditionNode?.id ??
        plan.expiryEmailNode.id,
      purpose: automation.purpose,
      prepared: expiryPrepared,
      plan,
      recipients: [],
      anchorStepOnTrigger: true,
      batchPhase: 'expiry',
      expiryPrepared,
      expiryEmailNodeId: plan.expiryEmailNode.id,
      waitBeforeExpiryNodeId: plan.waitBeforeExpiryNode?.id ?? null,
      waitBeforeExpiryDelayMs: 0,
      expiryFilterNodeId: plan.expiryFilterNode?.id ?? null,
      expiryWithinAmount: parsed?.amount ?? 3,
      expiryWithinUnit: parsed?.unit ?? 'days',
    });
  }

  private async enqueuePaymentReminderExpiryPhase(
    batch: Omit<
      UnpaidReminderBatchJob,
      'customerIds' | 'chunkIndex' | 'totalChunks'
    >,
  ): Promise<void> {
    if (!batch.expiryPrepared || !batch.expiryEmailNodeId) {
      await this.finishUnpaidReminderBatchExecution(
        batch as UnpaidReminderBatchJob,
        'wallet',
        [],
        { allowEmptySent: true },
      );
      return;
    }

    const unpaidCount =
      await this.recipientsService.countUnpaidCustomersForFunnel(batch.funnelId);
    if (unpaidCount === 0) {
      await this.finishUnpaidReminderBatchExecution(
        batch as UnpaidReminderBatchJob,
        'expiry',
        [],
        { allowEmptySent: true },
      );
      return;
    }

    const expiryBase: Omit<
      UnpaidReminderBatchJob,
      'customerIds' | 'recipients' | 'chunkIndex' | 'totalChunks'
    > = {
      executionId: batch.executionId,
      automationId: batch.automationId,
      businessId: batch.businessId,
      funnelId: batch.funnelId,
      campaignId: batch.campaignId,
      emailNodeId: batch.expiryEmailNodeId,
      conditionNodeId: batch.expiryFilterNodeId ?? batch.conditionNodeId,
      purpose: batch.purpose,
      prepared: batch.expiryPrepared,
      plan: batch.plan,
      anchorStepOnTrigger: batch.anchorStepOnTrigger,
      batchPhase: 'expiry',
      expiryPrepared: batch.expiryPrepared,
      expiryEmailNodeId: batch.expiryEmailNodeId,
      waitBeforeExpiryNodeId: batch.waitBeforeExpiryNodeId ?? null,
      waitBeforeExpiryDelayMs: 0,
      expiryFilterNodeId: batch.expiryFilterNodeId ?? null,
      expiryWithinAmount: batch.expiryWithinAmount ?? 3,
      expiryWithinUnit: batch.expiryWithinUnit ?? 'days',
    };

    const { totalChunks } = await this.enqueueUnpaidReminderChunksFromPages({
      funnelId: batch.funnelId,
      baseBatch: expiryBase,
      delayMs: 0,
      predictedTotalChunks: predictSendChunkCount(
        unpaidCount,
        AUTOMATION_SEND_CHUNK_SIZE,
      ),
    });

    if (totalChunks === 0) {
      await this.finishUnpaidReminderBatchExecution(
        batch as UnpaidReminderBatchJob,
        'expiry',
        [],
        { allowEmptySent: true },
      );
      return;
    }

    await this.executionService.updateCurrentNode(
      batch.executionId,
      batch.expiryEmailNodeId,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    void this.observabilityService.completeStep({
      executionId: batch.executionId,
      stepKey: 'wallet_email',
      status: AutomationExecutionStepStatus.COMPLETED,
    });
    this.logger.log(
      `Payment reminder expiry phase queued execution=${batch.executionId} chunks=${totalChunks} emailNode=${batch.expiryEmailNodeId} window=${batch.expiryWithinAmount ?? 3}${batch.expiryWithinUnit ?? 'days'}`,
    );
  }

  private async finishUnpaidReminderBatchExecution(
    batch: UnpaidReminderBatchJob,
    batchPhase: UnpaidReminderBatchPhase,
    sent: { customerId: number; email: string }[] = [],
    options?: { allowEmptySent?: boolean },
  ): Promise<void> {
    if (sent.length > 0) {
      const summary = sent
        .map((recipient) => `${recipient.email} (#${recipient.customerId})`)
        .join(', ');
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.plan.nodes[batch.plan.nodes.length - 1].id,
        customerId: sent[sent.length - 1].customerId,
        message:
          batchPhase === 'pass'
            ? `Flow completed (node_order end). QR pass emails sent to ${sent.length} customer(s): ${summary}`
            : batchPhase === 'wallet'
              ? `Flow completed (node_order end). Wallet reminder emails sent to ${sent.length} customer(s): ${summary}`
              : batchPhase === 'expiry'
                ? `Flow completed (node_order end). Offer expiry emails sent to ${sent.length} customer(s): ${summary}`
                : `Flow completed (node_order end). Emails sent to ${sent.length} customer(s): ${summary}`,
      });
    } else if (!options?.allowEmptySent && batch.recipients[0]?.customerId) {
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.emailNodeId,
        customerId: batch.recipients[0].customerId,
        message: 'Workflow completed. No emails were sent.',
        error: 'All send attempts failed',
      });
      if (batch.anchorStepOnTrigger) {
        await this.executionService.updateCurrentNode(
          batch.executionId,
          batch.plan.startNodeId,
        );
      }
      await this.executionService.markFailed(
        batch.executionId,
        'All send attempts failed',
      );
      void this.observabilityService.onExecutionFinished({
        executionId: batch.executionId,
        failed: true,
        error: 'All send attempts failed',
      });
      return;
    }

    await this.executionService.updateCurrentNode(
      batch.executionId,
      batch.plan.endNodeId,
    );
    await this.executionService.markCompleted(batch.executionId);

    void this.observabilityService.completeStep({
      executionId: batch.executionId,
      stepKey: this.unpaidReminderStepKey(batchPhase),
      status: AutomationExecutionStepStatus.COMPLETED,
    });
    void this.observabilityService.onExecutionFinished({
      executionId: batch.executionId,
    });

    if (batch.anchorStepOnTrigger) {
      const schedule = await this.cronScheduler.syncAutomationCron(
        batch.automationId,
        { restartFromNow: true, silent: true },
      );
      const nextCronAt =
        schedule?.nextCronAt?.toISOString() ??
        'unknown (automation inactive or cron removed)';
      this.logger.log(
        `${AutomationService.PAYMENT_REMINDER_CRON_LOG} CYCLE COMPLETE automation=${batch.automationId} execution=${batch.executionId} nextCronAt=${nextCronAt} action=full_cycle_done_reschedule_next_rerun_from_cron_node`,
      );
    }
  }

  async executeAutomation(
    automationId: number,
    user: User,
  ): Promise<ExecuteAutomationResponseDto> {
    requireAdminRole(
      user,
      'You do not have permission to execute automations.',
    );

    const automation = await this.findAutomationById(automationId);

    if (!automation.isActive) {
      throw new BadRequestException('Automation is not active');
    }

    if (
      automation.purpose !== AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER ||
      automation.trigger !== AutomationTrigger.SIGNUP
    ) {
      throw new BadRequestException(
        'Only signup payment-reminder automations can be run this way.',
      );
    }

    const { status } = await this.startExecution({ automationId }, user);

    return {
      executionId: status.executionId,
      status: status.status,
      isTerminal: status.isTerminal,
      unpaidCount: status.totalRecipients,
      totalRecipients: status.totalRecipients,
      emailsSent: status.emailsSent,
      progressPercent: status.progressPercent,
    };
  }

  async processExecution(id: number, user: User): Promise<void> {
    requireAdminRole(
      user,
      'You do not have permission to process automation executions.',
    );
    const execution = await this.executionService.findById(id);
    const node = await this.executionService.findNodeForAutomation(
      execution.automationId,
      execution.currentNodeId,
    );
    await this.queueService.addProcessExecution({
      executionId: id,
      nodeId: execution.currentNodeId,
      nodeType: node.type,
    });
  }

  async resumeExecution(id: number, user: User): Promise<void> {
    requireAdminRole(
      user,
      'You do not have permission to resume automation executions.',
    );
    await this.executionService.findById(id);
    await this.queueService.addResumeExecution({ executionId: id }, 0);
  }

  async isBuiltinPaymentPassEmailSuperseded(funnelId: number): Promise<boolean> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
      relations: ['campaign'],
    });
    if (!funnel) {
      return false;
    }

    const automations = await this.automationRepository.find({
      where: {
        isActive: true,
        trigger: AutomationTrigger.PAYMENT,
        purpose: AutomationPurpose.FUNNEL_PAYMENT,
      },
    });

    return automations.some((automation) =>
      this.matchesAutomationScope(
        automation,
        { funnelId } as FunnelEvent,
        funnel,
      ),
    );
  }

  async handleEvent(
    event: FunnelEvent,
    options?: {
      skipCancelPendingOnPayment?: boolean;
      onlyIfNoExecutionForPayment?: boolean;
    },
  ): Promise<void> {
    if (!event.customerId) {
      return;
    }

    if (
      event.eventType === FunnelEventType.PAYMENT &&
      event.paymentStatus !== FunnelPaymentStatus.PAID &&
      !event.funnelPaymentId
    ) {
      return;
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: event.funnelId },
      relations: ['campaign'],
    });
    if (!funnel) {
      return;
    }

    if (
      event.eventType === FunnelEventType.PAYMENT &&
      this.isPaidFunnelEvent(event) &&
      !options?.skipCancelPendingOnPayment
    ) {
      this.logger.log(
        `[Prepaid Offer] Paid payment event — customerId=${event.customerId} funnelId=${event.funnelId} paymentId=${event.funnelPaymentId ?? 'none'}`,
      );
      await this.cancelPendingExecutionsForCustomer(
        event.customerId,
        event.funnelId,
      );
    }

    const automations = await this.findAutomationsForFunnelEvent(event);
    if (
      event.eventType === FunnelEventType.PAYMENT &&
      this.isPaidFunnelEvent(event)
    ) {
      this.logger.log(
        `[Prepaid Offer] ${automations.length} active prepaid automation(s) eligible for funnel ${event.funnelId}`,
      );
    }
    for (const automation of automations) {
      if (
        automation.purpose === AutomationPurpose.FUNNEL_SIGNUP &&
        isBuiltinSignupPassEmailEnabled()
      ) {
        this.logger.log(
          `Starting FUNNEL_SIGNUP automation ${automation.id} for customer ${event.customerId} (built-in signup pass email also enabled)`,
        );
      }

      await this.tryStartAutomationForEvent(automation, event, funnel, options);
    }
  }

  async cancelPendingExecutionsForCustomer(
    customerId: number,
    funnelId: number,
  ): Promise<void> {
    const activeExecutions =
      await this.executionService.findActiveExecutionsForCustomer(customerId);

    for (const execution of activeExecutions) {
      const automation = execution.automation;
      if (!automation) {
        continue;
      }
      if (automation.funnelId && automation.funnelId !== funnelId) {
        continue;
      }
      // Prepaid Offer starts on payment — never cancel it when payment completes.
      if (automation.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
        this.logger.log(
          `[Prepaid Offer] Keeping active execution ${execution.id} for automation ${automation.id} — payment-triggered flow must continue`,
        );
        continue;
      }

      await this.queueService.removeResumeExecutionJob(execution.id);
      await this.logService.createLog({
        executionId: execution.id,
        nodeId: execution.currentNodeId,
        customerId,
        message: 'Workflow stopped — customer completed payment',
      });
      await this.executionService.markCompleted(execution.id);
    }
  }

  private async findAutomationsForFunnelEvent(
    event: FunnelEvent,
  ): Promise<Automation[]> {
    if (event.eventType === FunnelEventType.SIGNUP) {
      return this.automationRepository.find({
        where: {
          isActive: true,
          trigger: In([
            AutomationTrigger.SIGNUP,
            AutomationTrigger.ABANDONED_CHECKOUT,
          ]),
          purpose: In([
            AutomationPurpose.FUNNEL_SIGNUP,
            AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER,
            AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER,
          ]),
        },
      });
    }

    if (event.eventType === FunnelEventType.PAYMENT) {
      return this.automationRepository.find({
        where: {
          isActive: true,
          trigger: AutomationTrigger.PAYMENT,
          purpose: AutomationPurpose.FUNNEL_PAYMENT,
        },
      });
    }

    return [];
  }

  private async tryStartAutomationForEvent(
    automation: Automation,
    event: FunnelEvent,
    funnel: Funnel,
    options?: { onlyIfNoExecutionForPayment?: boolean },
  ): Promise<void> {
    if (!this.matchesAutomationScope(automation, event, funnel)) {
      if (automation.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
        this.logger.log(
          `[Prepaid Offer] Skipped automation ${automation.id} "${automation.name}" — not in scope for funnel ${event.funnelId}`,
        );
      }
      return;
    }

    if (!event.customerId) {
      return;
    }

    if (
      automation.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER &&
      automation.funnelId
    ) {
      if (await this.isCronDrivenAutomation(automation.id)) {
        return;
      }

      const eligible = await this.recipientsService.isSignedUpAndUnpaidOnFunnel(
        automation.funnelId,
        event.customerId,
      );
      if (!eligible) {
        return;
      }
    }

    const funnelPaymentId =
      event.funnelPaymentId != null && event.funnelPaymentId > 0
        ? event.funnelPaymentId
        : null;

    if (automation.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
      if (funnelPaymentId == null) {
        this.logger.warn(
          `[Prepaid Offer] Skipped automation ${automation.id} — missing funnelPaymentId for customer ${event.customerId}`,
        );
        return;
      }

      const alreadyStartedForPayment =
        await this.executionService.hasExecutionForFunnelPayment(
          automation.id,
          event.customerId,
          funnelPaymentId,
        );
      if (alreadyStartedForPayment) {
        this.logger.log(
          `[Prepaid Offer] Skipped automation ${automation.id} — payment ${funnelPaymentId} already has a journey for customer ${event.customerId}`,
        );
        return;
      }

      await this.supersedeActivePrepaidExecutionsForCustomer(
        automation.id,
        event.customerId,
        funnelPaymentId,
        event.funnelId,
      );
    } else if (automation.purpose !== AutomationPurpose.FUNNEL_SIGNUP) {
      const hasActive = await this.executionService.hasActiveExecution(
        automation.id,
        event.customerId,
      );
      if (hasActive) {
        return;
      }
    }

    const allowsRepeatRuns =
      automation.purpose === AutomationPurpose.FUNNEL_SIGNUP ||
      automation.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER ||
      automation.purpose === AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER ||
      automation.purpose === AutomationPurpose.FUNNEL_PAYMENT;

    if (!allowsRepeatRuns) {
      const alreadyCompleted =
        await this.executionService.hasCompletedExecutionForCustomer(
          automation.id,
          event.customerId,
        );
      if (alreadyCompleted) {
        return;
      }
    }

    const startNodeId = await this.executionService.resolveStartNodeId(
      automation.id,
    );
    if (!startNodeId) {
      return;
    }

    const triggerMatches = await this.startNodeMatchesEvent(
      automation,
      startNodeId,
      event.eventType,
    );
    if (!triggerMatches) {
      return;
    }

    const execution =
      automation.purpose === AutomationPurpose.FUNNEL_PAYMENT
        ? await this.executionService.createPrepaidExecutionForPayment(
            {
              automationId: automation.id,
              currentNodeId: startNodeId,
              purpose: automation.purpose,
            },
            event.customerId,
            funnelPaymentId!,
          )
        : await this.executionService.createExecution(
            {
              automationId: automation.id,
              currentNodeId: startNodeId,
              purpose: automation.purpose,
            },
            event.customerId,
            funnelPaymentId != null
              ? { executionContext: { funnelPaymentId } }
              : undefined,
          );

    if (!execution) {
      this.logger.log(
        `[Prepaid Offer] Skipped automation ${automation.id} — payment ${funnelPaymentId} journey already created (race)`,
      );
      return;
    }

    const startNode = await this.executionService.findNodeForAutomation(
      automation.id,
      startNodeId,
    );

    await this.queueService.addProcessExecution({
      executionId: execution.id,
      nodeId: startNodeId,
      nodeType: startNode.type,
    });

    if (automation.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
      this.logger.log(
        `[Prepaid Offer] Started execution ${execution.id} for customer ${event.customerId} — automation ${automation.id} "${automation.name}" on funnel ${event.funnelId} payment=${funnelPaymentId ?? 'none'}`,
      );
    }
  }

  private async supersedeActivePrepaidExecutionsForCustomer(
    automationId: number,
    customerId: number,
    incomingFunnelPaymentId: number | null,
    incomingFunnelId: number,
  ): Promise<void> {
    const activeExecutions =
      await this.executionService.findActiveExecutionsForCustomer(customerId);

    for (const execution of activeExecutions) {
      if (execution.automationId !== automationId) {
        continue;
      }
      if (execution.automation?.purpose !== AutomationPurpose.FUNNEL_PAYMENT) {
        continue;
      }

      const existingPaymentId = this.readFunnelPaymentIdFromContext(
        execution.executionContext,
      );
      if (
        incomingFunnelPaymentId != null &&
        existingPaymentId != null &&
        existingPaymentId === incomingFunnelPaymentId
      ) {
        continue;
      }

      if (existingPaymentId != null) {
        const existingPayment = await this.funnelPaymentRepository.findOne({
          where: { id: existingPaymentId },
          select: ['id', 'funnelId'],
        });
        if (
          existingPayment &&
          existingPayment.funnelId !== incomingFunnelId
        ) {
          continue;
        }
      }

      await this.queueService.removeResumeExecutionJob(execution.id);
      await this.logService.createLog({
        executionId: execution.id,
        nodeId: execution.currentNodeId,
        customerId,
        message: 'Workflow stopped — superseded by new payment',
      });
      await this.executionService.markCompleted(execution.id);
      this.logger.log(
        `[Prepaid Offer] Superseded active execution ${execution.id} for customer ${customerId} — starting new payment run`,
      );
    }
  }

  private readFunnelPaymentIdFromContext(
    context: Record<string, unknown> | null | undefined,
  ): number | null {
    const raw = context?.funnelPaymentId;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private isPaidFunnelEvent(event: FunnelEvent): boolean {
    return event.paymentStatus === FunnelPaymentStatus.PAID;
  }

  private mapFunnelEventToAutoPurpose(
    eventType: FunnelEventType,
  ): AutomationPurpose | null {
    if (eventType === FunnelEventType.SIGNUP) {
      return AutomationPurpose.FUNNEL_SIGNUP;
    }
    if (eventType === FunnelEventType.PAYMENT) {
      return AutomationPurpose.FUNNEL_PAYMENT;
    }
    return null;
  }

  private async startNodeMatchesEvent(
    automation: Automation,
    startNodeId: number,
    eventType: FunnelEventType,
  ): Promise<boolean> {
    const expectedTrigger = this.mapFunnelEventToTrigger(eventType);
    if (expectedTrigger && automation.trigger === expectedTrigger) {
      return true;
    }

    if (
      eventType === FunnelEventType.SIGNUP &&
      automation.trigger === AutomationTrigger.ABANDONED_CHECKOUT
    ) {
      return true;
    }

    const node = await this.nodeRepository.findOne({
      where: { id: startNodeId },
    });
    if (!node || node.type !== AutomationNodeType.TRIGGER) {
      return true;
    }

    const config = node.config ?? {};
    const configured = String(
      config.trigger ?? config.triggerType ?? config.event ?? '',
    )
      .trim()
      .toLowerCase();

    if (!configured) {
      return automation.trigger === expectedTrigger;
    }

    if (eventType === FunnelEventType.SIGNUP) {
      return (
        configured.includes('signup') || configured.includes('abandoned')
      );
    }
    if (eventType === FunnelEventType.PAYMENT) {
      return configured.includes('payment');
    }

    return false;
  }

  private mapFunnelEventToTrigger(
    eventType: FunnelEventType,
  ): AutomationTrigger | null {
    if (eventType === FunnelEventType.SIGNUP) {
      return AutomationTrigger.SIGNUP;
    }
    if (eventType === FunnelEventType.PAYMENT) {
      return AutomationTrigger.PAYMENT;
    }
    return null;
  }

  private assertCreatablePurpose(purpose: AutomationPurpose): void {
    if (purpose === AutomationPurpose.MANUAL) {
      throw new BadRequestException(
        'This automation purpose is no longer available.',
      );
    }
  }

  private validatePurposeAndTrigger(
    purpose: AutomationPurpose,
    trigger: AutomationTrigger,
  ): void {
    const signupPurposes = new Set<AutomationPurpose>([
      AutomationPurpose.FUNNEL_SIGNUP,
      AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER,
    ]);

    if (
      signupPurposes.has(purpose) &&
      trigger !== AutomationTrigger.SIGNUP &&
      trigger !== AutomationTrigger.CRON
    ) {
      throw new BadRequestException(
        'Signup payment reminder automations require trigger "signup" or "cron".',
      );
    }

    if (
      purpose === AutomationPurpose.FUNNEL_PAYMENT &&
      trigger !== AutomationTrigger.PAYMENT
    ) {
      throw new BadRequestException(
        'Post-payment automations require trigger "payment".',
      );
    }

    if (
      purpose === AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER &&
      trigger !== AutomationTrigger.ABANDONED_CHECKOUT
    ) {
      throw new BadRequestException(
        'Abandoned checkout automations require trigger "abandoned_checkout".',
      );
    }
  }

  private async assertPaymentReminderScheduleForAutomation(
    automation: Automation,
  ): Promise<void> {
    const nodes = await this.nodeRepository.find({
      where: { automationId: automation.id },
      order: { order: 'ASC', id: 'ASC' },
    });
    assertPaymentReminderScheduleValid(automation.purpose, nodes);
  }

  private async isCronDrivenAutomation(automationId: number): Promise<boolean> {
    const nodes = await this.nodeRepository.find({
      where: { automationId },
      order: { order: 'ASC', id: 'ASC' },
    });
    return resolveCronFromAutomationNodes(nodes) !== null;
  }

  private async startSignupPaymentReminderForEligibleCustomers(
    automation: Automation,
  ): Promise<void> {
    if (!automation.funnelId) {
      return;
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: automation.funnelId },
      relations: ['campaign'],
    });
    if (!funnel) {
      return;
    }

    await forEachRecipientPageChunks({
      pageSize: AUTOMATION_RECIPIENT_PAGE_SIZE,
      chunkSize: AUTOMATION_SEND_CHUNK_SIZE,
      fetchPage: (afterCustomerId, limit) =>
        this.recipientsService.getUnpaidCustomersForFunnelPage(
          automation.funnelId!,
          { afterCustomerId, limit },
        ),
      onChunk: async (chunk) => {
        for (const recipient of chunk) {
          if (recipient.customerId == null) {
            continue;
          }
          await this.tryStartAutomationForEvent(
            automation,
            {
              funnelId: automation.funnelId,
              customerId: recipient.customerId,
              eventType: FunnelEventType.SIGNUP,
            } as FunnelEvent,
            funnel,
          );
        }
      },
    });
  }

  private matchesAutomationScope(
    automation: Automation,
    event: FunnelEvent,
    funnel: Funnel,
  ): boolean {
    if (automation.funnelId && automation.funnelId !== event.funnelId) {
      return false;
    }

    if (automation.campaignId && automation.campaignId !== funnel.campaignId) {
      return false;
    }

    if (
      automation.businessId &&
      funnel.campaign?.businessId !== automation.businessId
    ) {
      return false;
    }

    return true;
  }

  async resumeWaitingExecutionsAfterCustomerVisit(
    customerId: number,
    campaignId: number,
  ): Promise<void> {
    const executions =
      await this.executionService.findPrepaidExecutionsForVisitResume(
        customerId,
        campaignId,
      );

    for (const execution of executions) {
      if (!execution.automation?.isActive) {
        continue;
      }

      if (
        await this.executionService.isExecutionPastVisitGateAsync(execution)
      ) {
        continue;
      }

      const postVisitNodeId =
        await this.executionService.findPostVisitEntryNodeId(
          execution.automationId,
        );
      if (!postVisitNodeId) {
        continue;
      }

      if (execution.status === AutomationExecutionStatus.COMPLETED) {
        const atVisitGate =
          execution.currentNode?.type === AutomationNodeType.CONDITION;
        if (!atVisitGate) {
          continue;
        }
        await this.executionService.reopenForVisitResume(execution.id);
      } else {
        await this.executionService.markProcessing(execution.id);
      }

      this.logger.log(
        `Resuming execution ${execution.id} after customer ${customerId} visited campaign ${campaignId}`,
      );

      await this.executionService.updateCurrentNode(
        execution.id,
        postVisitNodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );

      await this.logService.createLog({
        executionId: execution.id,
        nodeId: postVisitNodeId,
        customerId,
        message:
          'Customer visit recorded — continuing to post-visit thank-you emails',
      });

      const postVisitNode = await this.executionService.findNodeForAutomation(
        execution.automationId,
        postVisitNodeId,
      );

      await this.queueService.addProcessExecution({
        executionId: execution.id,
        nodeId: postVisitNodeId,
        nodeType: postVisitNode.type,
      });
    }
  }

  private async bumpAutomationGraphVersion(automationId: number): Promise<void> {
    await this.executionService.bumpAutomationVersion(automationId);
  }

  async getAutomationMetrics() {
    return this.metricsService.getSnapshot();
  }

  async listDeadLetters(limit?: number) {
    return this.deadLetterService.listPending(limit);
  }

  async retryDeadLetter(id: number, user: User) {
    requireAdminRole(
      user,
      'You do not have permission to retry dead-letter jobs.',
    );
    return this.deadLetterService.retryDeadLetter(id);
  }

  async discardDeadLetter(id: number, user: User) {
    requireAdminRole(
      user,
      'You do not have permission to discard dead-letter jobs.',
    );
    await this.deadLetterService.discardDeadLetter(id);
  }

  async getExecutionEvents(id: number) {
    return this.recoveryService.getExecutionEvents(id);
  }

  async getExecutionSteps(id: number) {
    await this.executionService.findById(id);
    return this.observabilityService.findSteps(id);
  }

  async getExecutionRecipients(
    id: number,
    customerId?: number,
  ) {
    await this.executionService.findById(id);
    return this.observabilityService.findRecipientOutcomes({
      executionId: id,
      customerId,
    });
  }

  async getExecutionSummary(id: number) {
    const execution = await this.executionService.findById(id);
    const steps = await this.observabilityService.findSteps(id);
    return {
      executionId: execution.id,
      status: execution.status,
      startedAt: execution.startedAt ?? execution.createdAt,
      completedAt: execution.completedAt,
      durationMs:
        execution.startedAt != null && execution.completedAt != null
          ? Math.max(
              0,
              execution.completedAt.getTime() - execution.startedAt.getTime(),
            )
          : null,
      metrics: {
        recipientsFound: execution.recipientsFound,
        recipientsEligible: execution.recipientsEligible,
        recipientsFiltered: execution.recipientsFiltered,
        recipientsSent: execution.recipientsSent,
        recipientsFailed: execution.recipientsFailed,
        recipientsSkipped: execution.recipientsSkipped,
        recipientsBounced: execution.recipientsBounced,
        recipientsPaidDuringWait: execution.recipientsPaidDuringWait,
        passEmailsSent: execution.passEmailsSent,
        emailsSentCount: execution.emailsSentCount,
      },
      summary: execution.summary,
      steps,
    };
  }

  async recoverStuckExecutions(user: User) {
    requireAdminRole(
      user,
      'You do not have permission to recover automations.',
    );
    const recovered =
      await this.observabilityService.recoverStuckExecutions();
    return { recovered };
  }

  async recoverExecution(id: number, user: User) {
    requireAdminRole(
      user,
      'You do not have permission to recover automation executions.',
    );
    return this.recoveryService.recoverExecution(id);
  }

  private async resolveScopeFromCampaign(
    campaignId: number,
    businessId?: number,
  ): Promise<{
    businessId: number;
    campaignId: number;
    funnelId: number;
  }> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (businessId !== undefined && campaign.businessId !== businessId) {
      throw new BadRequestException(
        'Campaign does not belong to this business',
      );
    }

    const funnel = await this.funnelRepository.findOne({
      where: { campaignId },
    });
    if (!funnel) {
      throw new BadRequestException(
        'No funnel exists for this campaign. Create a funnel for the campaign first.',
      );
    }

    return {
      businessId: campaign.businessId,
      campaignId: campaign.id,
      funnelId: funnel.id,
    };
  }
}
