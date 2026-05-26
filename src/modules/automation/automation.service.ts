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
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationEmailService } from './automation-email.service';
import { AutomationRecipientsService } from './automation-recipients.service';
import { AutomationFlowService } from './automation-flow.service';
import { AutomationCronSchedulerService } from './automation-cron-scheduler.service';
import { AutomationQueueService } from './automation-queue.service';
import type { EmailRecipient } from './automation-email.types';
import type { UnpaidReminderBatchJob } from './automation-queue.types';
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
      isActive: dto.isActive ?? true,
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
    await this.queueService.removeCronSchedule(id);
    await this.automationRepository.remove(automation);
  }

  async publishAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to publish automations.');
    const automation = await this.findAutomationById(id);
    automation.published = true;
    return this.automationRepository.save(automation);
  }

  async activateAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to activate automations.');
    const automation = await this.findAutomationById(id);
    automation.isActive = true;
    const saved = await this.automationRepository.save(automation);
    await this.cronScheduler.syncAutomationCron(saved.id);
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
    return saved;
  }

  async createNode(dto: CreateAutomationNodeDto): Promise<AutomationNode> {
    await this.findAutomationById(dto.automationId);

    const node = this.nodeRepository.create({
      automationId: dto.automationId,
      type: dto.type,
      config: dto.config ?? {},
      positionX: dto.positionX ?? 0,
      positionY: dto.positionY ?? 0,
      order: dto.order,
    });

    const saved = await this.nodeRepository.save(node);
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
      node.order = dto.order;
    }

    const saved = await this.nodeRepository.save(node);
    await this.cronScheduler.syncAutomationCron(saved.automationId);
    return saved;
  }

  async deleteNode(id: number): Promise<void> {
    const node = await this.nodeRepository.findOne({ where: { id } });
    if (!node) {
      throw new NotFoundException('Automation node not found');
    }
    const automationId = node.automationId;
    await this.nodeRepository.remove(node);
    await this.cronScheduler.syncAutomationCron(automationId);
  }

  async createConnection(
    dto: CreateAutomationConnectionDto,
  ): Promise<AutomationConnection> {
    await this.findAutomationById(dto.automationId);

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

    return this.connectionRepository.save(connection);
  }

  async deleteConnection(id: number): Promise<void> {
    const connection = await this.connectionRepository.findOne({
      where: { id },
    });
    if (!connection) {
      throw new NotFoundException('Automation connection not found');
    }
    await this.connectionRepository.remove(connection);
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

    await this.executionService.deleteById(id);
  }

  async getExecutionStatus(
    executionId: number,
  ): Promise<AutomationExecutionStatusDto> {
    const execution = await this.executionService.findById(executionId);
    return this.buildExecutionStatusDto(execution);
  }

  private toExecutionListItem(
    execution: AutomationExecution,
  ): ExecutionListItemDto {
    const customerCount =
      execution.totalRecipients > 0
        ? execution.totalRecipients
        : execution.emailsSentCount;

    return {
      runId: execution.id,
      id: execution.id,
      status: execution.status,
      startedAt: execution.createdAt,
      customerCount,
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

    if (!automation?.isActive) {
      return;
    }

    if (!automation.funnelId) {
      this.logger.warn(
        `Cron tick skipped for automation ${automationId}: no funnel linked`,
      );
      return;
    }

    if (
      await this.executionService.hasActiveExecutionForAutomation(automationId)
    ) {
      this.logger.log(
        `Cron tick skipped for automation ${automationId}: execution already running`,
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

    const campaignName =
      automation.campaign?.campaignName?.trim() || 'the campaign';
    const prepared = this.automationEmailService.prepareFromEmailNode(
      plan.emailNode!.config ?? {},
      automation.purpose,
      { requireSubject: true, campaignName },
    );

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
      emailNodeId: plan.emailNode!.id,
      conditionNodeId: plan.conditionNode?.id ?? plan.emailNode!.id,
      purpose: automation.purpose,
      prepared,
      plan,
      recipients,
      anchorStepOnTrigger,
    };

    const queueJobId =
      await this.queueService.addUnpaidReminderBatch(batch);
    await this.executionService.setQueueJobId(execution.id, queueJobId);

    return {
      status: await this.getExecutionStatus(execution.id),
    };
  }

  async runUnpaidReminderBatch(batch: UnpaidReminderBatchJob): Promise<void> {
    await this.executionService.markProcessing(batch.executionId);

    if (!batch.anchorStepOnTrigger) {
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

    const sent: { customerId: number; email: string }[] = [];
    const pathSummary = batch.plan.nodes
      .map((node) => `order ${node.order}:${node.type}`)
      .join(' → ');
    const firstCustomerId = batch.recipients[0].customerId;

    await this.logService.createLog({
      executionId: batch.executionId,
      nodeId: batch.emailNodeId,
      customerId: firstCustomerId,
      message: `Step 0 email node: subject "${batch.prepared.subject}" loaded. Flow: ${pathSummary}`,
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

    try {
      const sendResult = await this.automationEmailService.sendBulkToRecipients(
        batch.purpose,
        batch.recipients,
        batch.prepared,
        ['unpaid_reminder_batch'],
      );

      if (!sendResult.sent) {
        throw new Error(sendResult.error ?? 'Bulk email send failed');
      }

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
          message: `Payment reminder email sent to ${recipient.email} (bulk)`,
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

    if (sent.length > 0) {
      const summary = sent
        .map((recipient) => `${recipient.email} (#${recipient.customerId})`)
        .join(', ');
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.plan.nodes[batch.plan.nodes.length - 1].id,
        customerId: sent[sent.length - 1].customerId,
        message: `Flow completed (node_order end). Emails sent to ${sent.length} customer(s): ${summary}`,
      });
    } else if (batch.recipients[0]) {
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
    await this.queueService.addProcessExecution({
      executionId: id,
      nodeId: execution.currentNodeId,
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

    const trigger = this.mapFunnelEventToTrigger(event.eventType);
    if (!trigger) {
      return;
    }

    const purpose = this.mapFunnelEventToAutoPurpose(event.eventType);
    if (!purpose) {
      return;
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: event.funnelId },
      relations: ['campaign'],
    });
    if (!funnel) {
      return;
    }

    const automations = await this.automationRepository.find({
      where: {
        trigger,
        purpose,
        isActive: true,
      } as FindOptionsWhere<Automation>,
    });

    for (const automation of automations) {
      if (!this.matchesAutomationScope(automation, event, funnel)) {
        continue;
      }

      const hasActive = await this.executionService.hasActiveExecution(
        automation.id,
        event.customerId,
      );
      if (hasActive) {
        continue;
      }

      const alreadyCompleted =
        await this.executionService.hasCompletedExecutionForCustomer(
          automation.id,
          event.customerId,
        );
      if (alreadyCompleted) {
        continue;
      }

      const startNodeId = await this.executionService.resolveStartNodeId(
        automation.id,
      );
      if (!startNodeId) {
        continue;
      }

      const triggerMatches = await this.startNodeMatchesEvent(
        automation,
        startNodeId,
        event.eventType,
      );
      if (!triggerMatches) {
        continue;
      }

      const execution = await this.executionService.createExecution(
        {
          automationId: automation.id,
          currentNodeId: startNodeId,
          purpose: automation.purpose,
        },
        event.customerId,
      );

      await this.queueService.addProcessExecution({
        executionId: execution.id,
        nodeId: startNodeId,
      });
    }
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
      return configured.includes('signup');
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
      trigger !== AutomationTrigger.SIGNUP
    ) {
      throw new BadRequestException(
        'Signup payment reminder automations require trigger "signup".',
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
