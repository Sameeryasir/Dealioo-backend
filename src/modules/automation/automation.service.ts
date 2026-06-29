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
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { ActivityService } from '../activity/activity.service';
import { ChatMessageService } from '../chat/chat-message.service';
import { ConversationMessageChannel } from '../../db/entities/conversation-message.entity';
import { CheckoutResumeService } from '../payment/checkout-resume.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationEmailService } from './automation-email.service';
import { AutomationRecipientsService } from './automation-recipients.service';
import { AutomationFlowService } from './automation-flow.service';
import { AutomationCronSchedulerService } from './automation-cron-scheduler.service';
import {
  clampAutomationNodeOrder,
  isCronTriggerAutomationNode,
  isCronTriggerNodePayload,
  resolveCronFromAutomationNodes,
} from './automation-cron.config';
import { AutomationQueueService } from './automation-queue.service';
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
import { UpdateAutomationNodeDto } from './automationDto/update-automation-node.dto';
import { resolveWaitDelayMinutes } from './automation-wait.util';
import { assertPaymentReminderScheduleValid } from './payment-reminder-schedule.util';

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(Automation)
    private readonly automationRepository: Repository<Automation>,
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
    @InjectRepository(AutomationConnection)
    private readonly connectionRepository: Repository<AutomationConnection>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
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
    private readonly activityService: ActivityService,
    private readonly chatMessageService: ChatMessageService,
    private readonly checkoutResumeService: CheckoutResumeService,
  ) {}

  async createAutomation(
    dto: CreateAutomationDto,
    user: User,
  ): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to create automations.');

    const { restaurantId, campaignId, funnelId } =
      await this.resolveScopeFromCampaign(dto.campaignId, dto.restaurantId);

    this.validatePurposeAndTrigger(dto.purpose, dto.trigger);

    const automation = this.automationRepository.create({
      restaurantId,
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

    return this.automationRepository.save(automation);
  }

  async updateAutomation(
    id: number,
    dto: UpdateAutomationDto,
    user: User,
  ): Promise<Automation> {
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
        dto.restaurantId,
      );
      automation.restaurantId = scope.restaurantId;
      automation.campaignId = scope.campaignId;
      automation.funnelId = scope.funnelId;
    }

    const saved = await this.automationRepository.save(automation);
    await this.cronScheduler.syncAutomationCron(saved.id);

    if (wasActive && !saved.isActive) {
      await this.pauseAutomationExecutions(saved.id);
    }

    if (
      !wasActive &&
      saved.isActive &&
      saved.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER &&
      !(await this.isCronDrivenAutomation(saved.id))
    ) {
      await this.startSignupPaymentReminderForEligibleCustomers(saved);
    }

    if (!wasActive && saved.isActive) {
      await this.resumePausedExecutionsForAutomation(saved.id);
    }

    return saved;
  }

  async getAutomations(restaurantId?: number): Promise<Automation[]> {
    if (restaurantId) {
      const restaurant = await this.restaurantRepository.findOne({
        where: { id: restaurantId },
      });
      if (!restaurant) {
        throw new NotFoundException('Restaurant not found');
      }
      return this.automationRepository.find({
        where: { restaurantId },
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
    await this.automationRepository.remove(automation);
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
    const saved = await this.automationRepository.save(automation);
    await this.cronScheduler.syncAutomationCron(saved.id);

    if (
      !wasActive &&
      saved.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER &&
      !(await this.isCronDrivenAutomation(saved.id))
    ) {
      await this.startSignupPaymentReminderForEligibleCustomers(saved);
    }

    await this.resumePausedExecutionsForAutomation(saved.id);

    return saved;
  }

  async deactivateAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(
      user,
      'You do not have permission to deactivate automations.',
    );
    const automation = await this.findAutomationById(id);
    automation.isActive = false;
    const saved = await this.automationRepository.save(automation);
    await this.cronScheduler.syncAutomationCron(saved.id);

    await this.pauseAutomationExecutions(saved.id);

    return saved;
  }

  private async pauseAutomationExecutions(automationId: number): Promise<void> {
    const pausedExecutionIds =
      await this.executionService.pauseInProgressExecutionsForAutomation(
        automationId,
      );
    if (pausedExecutionIds.length > 0) {
      await this.queueService.purgeExecutionJobs(pausedExecutionIds);
      this.logger.log(
        `Paused ${pausedExecutionIds.length} execution(s) for automation ${automationId}`,
      );
    }
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
        await this.queueService.addResumeExecution(
          { executionId: execution.id },
          delayMs,
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

    await this.assertAutomationEditable(node.automationId);

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
    await this.cronScheduler.syncAutomationCron(saved.automationId);
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

    if (
      await this.executionService.hasBlockingBatchSendForAutomation(automationId)
    ) {
      this.logger.log(
        `Cron tick skipped for automation ${automationId}: batch send already in progress`,
      );
      return;
    }

    try {
      const result = await this.enqueueUnpaidReminderBatch(automation, {
        skipIfNoRecipients: true,
        triggeredByCron: true,
      });
      if (!result) {
        this.logger.log(
          `Cron tick for automation ${automationId}: no unpaid recipients`,
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

    let recipients: EmailRecipient[] = [];
    if (plan.sendToUnpaidOnly) {
      recipients = await this.recipientsService.getUnpaidCustomersForFunnel(
        automation.funnelId!,
      );
      if (recipients.length === 0) {
        if (options.skipIfNoRecipients) {
          return null;
        }
        throw new BadRequestException(
          'No unpaid customers found for this funnel',
        );
      }
    } else {
      throw new BadRequestException(
        'Flow condition must target customers who have not completed payment.',
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
      recipients[0].customerId,
      {
        status: AutomationExecutionStatus.QUEUED,
        totalRecipients: recipients.length,
      },
    );

    const batch: UnpaidReminderBatchJob = {
      executionId: execution.id,
      automationId: automation.id,
      restaurantId: automation.restaurantId,
      funnelId: automation.funnelId!,
      campaignId: automation.campaignId ?? automation.campaign?.id ?? null,
      emailNodeId: actionNode.id,
      conditionNodeId: plan.conditionNode?.id ?? actionNode.id,
      purpose: automation.purpose,
      prepared,
      plan,
      recipients,
      anchorStepOnTrigger,
      batchPhase: 'payment',
      passPrepared,
      passEmailNodeId: plan.passEmailNode?.id ?? null,
      waitBeforePassNodeId: plan.waitBeforePassNode?.id ?? null,
      waitDelayMs,
    };

    const queueJobId =
      await this.queueService.addUnpaidReminderBatch(batch);
    await this.executionService.setQueueJobId(execution.id, queueJobId);

    return {
      status: await this.getExecutionStatus(execution.id),
    };
  }

  async runUnpaidReminderBatch(batch: UnpaidReminderBatchJob): Promise<void> {
    const batchPhase = batch.batchPhase ?? 'payment';
    const actionNode = batch.plan.emailNode ?? batch.plan.smsNode;
    const isSmsBatch = Boolean(batch.plan.smsNode && !batch.plan.emailNode);
    const sendAsEmail =
      Boolean(batch.prepared) &&
      (batch.purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER ||
        batch.purpose === AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER ||
        Boolean(batch.plan.emailNode));

    const firstCustomerId = batch.recipients[0]?.customerId;
    if (firstCustomerId == null) {
      await this.executionService.markFailed(
        batch.executionId,
        'No recipients in batch',
      );
      return;
    }

    const phaseAlreadySent = await this.logService.hasBatchPhaseEmailSent(
      batch.executionId,
      batch.emailNodeId,
      batchPhase,
    );

    if (batchPhase === 'pass') {
      batch.recipients = await this.recipientsService.filterStillUnpaidRecipients(
        batch.funnelId,
        batch.recipients,
      );

      if (batch.recipients.length === 0) {
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          customerId: firstCustomerId,
          message:
            'QR pass email skipped — all recipients completed payment during wait',
        });
        await this.finishUnpaidReminderBatchExecution(batch, batchPhase, [], {
          allowEmptySent: true,
        });
        return;
      }

      if (phaseAlreadySent) {
        await this.finishUnpaidReminderBatchExecution(batch, batchPhase, [], {
          allowEmptySent: true,
        });
        return;
      }
    } else if (phaseAlreadySent) {
      await this.schedulePassFollowUpIfNeeded(batch, firstCustomerId);
      return;
    }

    await this.executionService.markProcessing(batch.executionId);

    if (!batch.anchorStepOnTrigger && batchPhase === 'payment') {
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

    if (batchPhase === 'pass' && batch.waitBeforePassNodeId) {
      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.waitBeforePassNodeId,
      );
      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.emailNodeId,
      );
    }

    const sent: { customerId: number; email: string }[] = [];
    const pathSummary = batch.plan.nodes
      .map((node) => `order ${node.order}:${node.type}`)
      .join(' → ');

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
        message: `Step 1 condition: "${conditionLabel}" — sending to ${batch.recipients.length} unpaid customer(s)`,
      });
    }

    if (isSmsBatch && !sendAsEmail) {
      const smsMessage = String(actionNode?.config?.message ?? '').trim();

      for (const recipient of batch.recipients) {
        if (!recipient.customerId) {
          continue;
        }
        await this.executionService.updateCustomerId(
          batch.executionId,
          recipient.customerId,
        );
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          customerId: recipient.customerId,
          message: `Payment reminder text sent to ${recipient.email} (bulk)`,
        });
        await this.chatMessageService.recordOutboundMessage({
          restaurantId: batch.restaurantId,
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
          },
        });
        sent.push({
          customerId: recipient.customerId,
          email: recipient.email,
        });
      }

      if (sent.length === 0 && batch.recipients[0]) {
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          customerId: batch.recipients[0].customerId,
          message: 'Workflow completed. No texts were sent.',
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
        return;
      }

      if (sent.length > 0) {
        const summary = sent
          .map((recipient) => `${recipient.email} (#${recipient.customerId})`)
          .join(', ');
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.plan.nodes[batch.plan.nodes.length - 1].id,
          customerId: sent[sent.length - 1].customerId,
          message: `Flow completed (node_order end). Texts sent to ${sent.length} customer(s): ${summary}`,
        });
        if (smsMessage) {
          await this.executionService.incrementEmailsSentBy(
            batch.executionId,
            sent.length,
          );
        }
      }

      if (batch.anchorStepOnTrigger) {
        await this.executionService.updateCurrentNode(
          batch.executionId,
          batch.plan.startNodeId,
        );
      } else {
        await this.executionService.updateCurrentNode(
          batch.executionId,
          batch.plan.endNodeId,
        );
      }
      await this.executionService.markCompleted(batch.executionId);
      return;
    }

    try {
      const recipientTemplateOverrides = new Map<
        number,
        Partial<PreparedAutomationEmail['templateProps']>
      >();

      if (
        batchPhase === 'payment' &&
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
              restaurantId: batch.restaurantId,
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

      if (batchPhase === 'pass') {
        for (const recipient of batch.recipients) {
          if (!recipient.customerId) {
            continue;
          }
          recipientTemplateOverrides.set(recipient.customerId, {
            ctaUrl: `${getFrontendBaseUrl()}/pass/guest/${recipient.customerId}/${batch.funnelId}`,
          });
        }
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
        await this.executionService.updateCustomerId(
          batch.executionId,
          recipient.customerId,
        );
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
          restaurantId: batch.restaurantId,
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
          restaurantId: batch.restaurantId,
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
          },
        });
        sent.push({
          customerId: recipient.customerId,
          email: recipient.email,
        });
      }

      await this.executionService.incrementEmailsSentBy(
        batch.executionId,
        sendResult.recipientCount,
      );

      if (
        batchPhase === 'payment' &&
        batch.passPrepared &&
        batch.passEmailNodeId
      ) {
        await this.schedulePassFollowUpIfNeeded(batch, firstCustomerId);
        return;
      }
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
      if (batch.anchorStepOnTrigger) {
        await this.executionService.updateCurrentNode(
          batch.executionId,
          batch.plan.startNodeId,
        );
      }
      await this.executionService.markFailed(batch.executionId, message);
      return;
    }

    await this.finishUnpaidReminderBatchExecution(batch, batchPhase, sent);
  }

  private async schedulePassFollowUpIfNeeded(
    batch: UnpaidReminderBatchJob,
    customerId: number,
  ): Promise<void> {
    if (!batch.passPrepared || !batch.passEmailNodeId) {
      return;
    }

    if (await this.logService.hasPassFollowUpScheduled(batch.executionId)) {
      const waitNodeId = batch.waitBeforePassNodeId ?? batch.passEmailNodeId;
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

    await this.queueService.addUnpaidReminderBatch(
      {
        ...batch,
        batchPhase: 'pass',
        emailNodeId: batch.passEmailNodeId,
        prepared: batch.passPrepared,
        anchorStepOnTrigger: false,
      },
      batch.waitDelayMs ?? 0,
    );

    const waitNodeId = batch.waitBeforePassNodeId ?? batch.passEmailNodeId;
    await this.executionService.updateCurrentNode(
      batch.executionId,
      waitNodeId,
      AutomationExecutionStatus.WAITING,
      batch.waitDelayMs && batch.waitDelayMs > 0
        ? new Date(Date.now() + batch.waitDelayMs)
        : null,
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
      return;
    }

    if (batch.anchorStepOnTrigger) {
      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.plan.startNodeId,
      );
    } else {
      await this.executionService.updateCurrentNode(
        batch.executionId,
        batch.plan.endNodeId,
      );
    }
    await this.executionService.markCompleted(batch.executionId);
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

  async handleEvent(event: FunnelEvent): Promise<void> {
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
      this.isPaidFunnelEvent(event)
    ) {
      await this.cancelPendingExecutionsForCustomer(
        event.customerId,
        event.funnelId,
      );
    }

    const automations = await this.findAutomationsForFunnelEvent(event);
    for (const automation of automations) {
      if (
        automation.purpose === AutomationPurpose.FUNNEL_SIGNUP &&
        isBuiltinSignupPassEmailEnabled()
      ) {
        this.logger.log(
          `Skipping FUNNEL_SIGNUP automation for customer ${event.customerId} — built-in signup pass email is enabled`,
        );
        continue;
      }

      await this.tryStartAutomationForEvent(automation, event, funnel);
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
  ): Promise<void> {
    if (!this.matchesAutomationScope(automation, event, funnel)) {
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

    const hasActive = await this.executionService.hasActiveExecution(
      automation.id,
      event.customerId,
    );
    if (hasActive) {
      return;
    }

    const alreadyCompleted =
      await this.executionService.hasCompletedExecutionForCustomer(
        automation.id,
        event.customerId,
      );
    if (alreadyCompleted) {
      return;
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

    const execution = await this.executionService.createExecution(
      {
        automationId: automation.id,
        currentNodeId: startNodeId,
        purpose: automation.purpose,
      },
      event.customerId,
    );

    const startNode = await this.executionService.findNodeForAutomation(
      automation.id,
      startNodeId,
    );

    await this.queueService.addProcessExecution({
      executionId: execution.id,
      nodeId: startNodeId,
      nodeType: startNode.type,
    });
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

    const customerIds =
      await this.recipientsService.findSignedUpUnpaidCustomerIdsForFunnel(
        automation.funnelId,
      );

    for (const customerId of customerIds) {
      await this.tryStartAutomationForEvent(
        automation,
        {
          funnelId: automation.funnelId,
          customerId,
          eventType: FunnelEventType.SIGNUP,
        } as FunnelEvent,
        funnel,
      );
    }
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
      automation.restaurantId &&
      funnel.campaign?.restaurantId !== automation.restaurantId
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

  async recoverExecution(id: number, user: User) {
    requireAdminRole(
      user,
      'You do not have permission to recover automation executions.',
    );
    return this.recoveryService.recoverExecution(id);
  }

  private async resolveScopeFromCampaign(
    campaignId: number,
    restaurantId?: number,
  ): Promise<{
    restaurantId: number;
    campaignId: number;
    funnelId: number;
  }> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (restaurantId !== undefined && campaign.restaurantId !== restaurantId) {
      throw new BadRequestException(
        'Campaign does not belong to this restaurant',
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
      restaurantId: campaign.restaurantId,
      campaignId: campaign.id,
      funnelId: funnel.id,
    };
  }
}
