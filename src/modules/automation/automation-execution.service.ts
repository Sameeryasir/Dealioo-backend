import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
  type PaginationParams,
} from '../../common/pagination';
import { Automation } from '../../db/entities/automation.entity';
import { AutomationConnection } from '../../db/entities/automation-connection.entity';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { PusherService } from '../pusher/pusher.service';
import { isCustomerVisitedCondition } from './automation-visit.util';
import { CreateAutomationExecutionDto } from './automationDto/create-automation-execution.dto';

@Injectable()
export class AutomationExecutionService {
  constructor(
    @InjectRepository(AutomationExecution)
    private readonly executionRepository: Repository<AutomationExecution>,
    @InjectRepository(AutomationConnection)
    private readonly connectionRepository: Repository<AutomationConnection>,
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
    @InjectRepository(Automation)
    private readonly automationRepository: Repository<Automation>,
    private readonly pusherService: PusherService,
  ) {}

  async createExecution(
    dto: CreateAutomationExecutionDto,
    customerId: number,
    options?: {
      status?: AutomationExecutionStatus;
      totalRecipients?: number;
      executionContext?: Record<string, unknown>;
    },
  ): Promise<AutomationExecution> {
    const node = await this.nodeRepository.findOne({
      where: { id: dto.currentNodeId, automationId: dto.automationId },
    });
    if (!node) {
      throw new NotFoundException('Start node not found for this automation');
    }

    const automation = await this.automationRepository.findOne({
      where: { id: dto.automationId },
      select: ['id', 'version'],
    });

    const execution = this.executionRepository.create({
      automationId: dto.automationId,
      customerId,
      currentNodeId: dto.currentNodeId,
      purpose: dto.purpose,
      status: options?.status ?? AutomationExecutionStatus.RUNNING,
      scheduledAt: null,
      totalRecipients: options?.totalRecipients ?? 0,
      emailsSentCount: 0,
      queueJobId: null,
      lastError: null,
      automationVersion: automation?.version ?? 1,
      executionContext: options?.executionContext ?? {},
      lastEventId: null,
      startedAt: new Date(),
      completedAt: null,
      attemptNumber: 1,
      nextRetryAt: null,
      recipientsFound: options?.totalRecipients ?? 0,
      recipientsEligible: options?.totalRecipients ?? 0,
      recipientsFiltered: 0,
      recipientsSent: 0,
      recipientsFailed: 0,
      recipientsSkipped: 0,
      recipientsBounced: 0,
      recipientsPaidDuringWait: 0,
      passEmailsSent: 0,
      summary: null,
    });

    return this.executionRepository.save(execution);
  }

  async createPrepaidExecutionForPayment(
    dto: CreateAutomationExecutionDto,
    customerId: number,
    funnelPaymentId: number,
  ): Promise<AutomationExecution | null> {
    if (!Number.isFinite(funnelPaymentId) || funnelPaymentId < 1) {
      return this.createExecution(dto, customerId, {
        executionContext: { funnelPaymentId },
      });
    }

    return this.executionRepository.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
        dto.automationId,
        customerId,
      ]);

      const existingForPayment = await manager
        .createQueryBuilder(AutomationExecution, 'execution')
        .select('execution.id', 'id')
        .where('execution.automation_id = :automationId', {
          automationId: dto.automationId,
        })
        .andWhere('execution.customer_id = :customerId', { customerId })
        .andWhere('execution.status != :failed', {
          failed: AutomationExecutionStatus.FAILED,
        })
        .andWhere(
          `(execution.execution_context->>'funnelPaymentId')::int = :funnelPaymentId`,
          { funnelPaymentId },
        )
        .limit(1)
        .getRawOne<{ id: string | number }>();

      if (existingForPayment != null) {
        return null;
      }

      const activeStatuses = [
        AutomationExecutionStatus.QUEUED,
        AutomationExecutionStatus.RUNNING,
        AutomationExecutionStatus.WAITING,
      ];
      const activeRows = await manager.find(AutomationExecution, {
        where: {
          automationId: dto.automationId,
          customerId,
          status: In(activeStatuses),
        },
      });

      for (const row of activeRows) {
        const existingPaymentId = this.readFunnelPaymentIdFromContext(
          row.executionContext,
        );
        if (existingPaymentId === funnelPaymentId) {
          return null;
        }
        await manager.update(AutomationExecution, row.id, {
          status: AutomationExecutionStatus.COMPLETED,
          scheduledAt: null,
          queueJobId: null,
        });
      }

      const node = await manager.findOne(AutomationNode, {
        where: { id: dto.currentNodeId, automationId: dto.automationId },
      });
      if (!node) {
        throw new NotFoundException('Start node not found for this automation');
      }

      const automation = await manager.findOne(Automation, {
        where: { id: dto.automationId },
        select: ['id', 'version'],
      });

      const execution = manager.create(AutomationExecution, {
        automationId: dto.automationId,
        customerId,
        currentNodeId: dto.currentNodeId,
        purpose: dto.purpose,
        status: AutomationExecutionStatus.RUNNING,
        scheduledAt: null,
        totalRecipients: 0,
        emailsSentCount: 0,
        queueJobId: null,
        lastError: null,
        automationVersion: automation?.version ?? 1,
        executionContext: { funnelPaymentId },
        lastEventId: null,
      });

      return manager.save(execution);
    });
  }

  private readFunnelPaymentIdFromContext(
    context: Record<string, unknown> | null | undefined,
  ): number | null {
    const raw = context?.funnelPaymentId;
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  async hasExecutionForFunnelPayment(
    automationId: number,
    customerId: number,
    funnelPaymentId: number,
  ): Promise<boolean> {
    if (!Number.isFinite(funnelPaymentId) || funnelPaymentId < 1) {
      return false;
    }

    const row = await this.executionRepository
      .createQueryBuilder('execution')
      .select('execution.id', 'id')
      .where('execution.automation_id = :automationId', { automationId })
      .andWhere('execution.customer_id = :customerId', { customerId })
      .andWhere('execution.status != :failed', {
        failed: AutomationExecutionStatus.FAILED,
      })
      .andWhere(
        `(execution.execution_context->>'funnelPaymentId')::int = :funnelPaymentId`,
        { funnelPaymentId },
      )
      .limit(1)
      .getRawOne<{ id: string | number }>();

    return row != null;
  }

  async setQueueJobId(
    executionId: number,
    queueJobId: string,
  ): Promise<AutomationExecution> {
    const execution = await this.findById(executionId);
    execution.queueJobId = queueJobId;
    return this.executionRepository.save(execution);
  }

  async markProcessing(executionId: number): Promise<AutomationExecution> {
    const execution = await this.findById(executionId);
    execution.status = AutomationExecutionStatus.RUNNING;
    execution.lastError = null;
    if (!execution.startedAt) {
      execution.startedAt = new Date();
    }
    return this.executionRepository.save(execution);
  }

  async incrementEmailsSent(executionId: number): Promise<void> {
    await this.incrementEmailsSentBy(executionId, 1);
  }

  async incrementEmailsSentBy(
    executionId: number,
    count: number,
  ): Promise<void> {
    if (!Number.isFinite(count) || count <= 0) {
      return;
    }
    await this.executionRepository.increment(
      { id: executionId },
      'emailsSentCount',
      count,
    );
  }

  async findNodeForAutomation(
    automationId: number,
    nodeId: number,
  ): Promise<AutomationNode> {
    const node = await this.nodeRepository.findOne({
      where: { id: nodeId, automationId },
    });
    if (!node) {
      throw new NotFoundException('Automation node not found for this flow');
    }
    return node;
  }

  async findNodeByWorkflowKind(
    automationId: number,
    workflowKind: string,
  ): Promise<AutomationNode | null> {
    const normalized = workflowKind.trim();
    if (!normalized) {
      return null;
    }

    const nodes = await this.nodeRepository.find({
      where: { automationId },
      order: { order: 'ASC', id: 'ASC' },
    });

    return (
      nodes.find(
        (node) => String(node.config?.workflowKind ?? '').trim() === normalized,
      ) ?? null
    );
  }

  async findCustomerVisitedGateOrder(
    automationId: number,
  ): Promise<number | null> {
    const nodes = await this.nodeRepository.find({
      where: { automationId, type: AutomationNodeType.CONDITION },
      order: { order: 'ASC', id: 'ASC' },
    });

    for (const node of nodes) {
      const config = node.config ?? {};
      const conditionType = String(
        config.conditionType ?? config.type ?? '',
      ).trim();
      if (isCustomerVisitedCondition(conditionType)) {
        return node.order;
      }
    }

    return null;
  }

  async findPrepaidFirstEmailLoopNode(
    automationId: number,
  ): Promise<AutomationNode | null> {
    const byKind = await this.findNodeByWorkflowKind(
      automationId,
      'prepaid_payment_actions',
    );
    if (byKind?.type === AutomationNodeType.EMAIL) {
      return byKind;
    }

    const visitGateOrder = await this.findCustomerVisitedGateOrder(automationId);
    const nodes = await this.nodeRepository.find({
      where: { automationId },
      order: { order: 'ASC', id: 'ASC' },
    });

    for (const node of nodes) {
      if (node.type === AutomationNodeType.TRIGGER) {
        continue;
      }
      if (visitGateOrder != null && node.order >= visitGateOrder) {
        break;
      }
      if (node.type === AutomationNodeType.EMAIL) {
        return node;
      }
    }

    return null;
  }

  async findPrepaidVisitReminderLoopNode(
    automationId: number,
  ): Promise<AutomationNode | null> {
    const visitGateOrder = await this.findCustomerVisitedGateOrder(automationId);
    const nodes = await this.nodeRepository.find({
      where: { automationId },
      order: { order: 'ASC', id: 'ASC' },
    });

    let lastEmailBeforeVisitGate: AutomationNode | null = null;

    for (const node of nodes) {
      if (node.type === AutomationNodeType.TRIGGER) {
        continue;
      }
      if (visitGateOrder != null && node.order >= visitGateOrder) {
        break;
      }
      if (node.type === AutomationNodeType.EMAIL) {
        lastEmailBeforeVisitGate = node;
      }
    }

    return lastEmailBeforeVisitGate;
  }

  async findPrepaidVisitReminderWaitLoopNode(
    automationId: number,
  ): Promise<AutomationNode | null> {
    const reminderNode = await this.findPrepaidVisitReminderLoopNode(automationId);
    if (!reminderNode) {
      return null;
    }

    const inbound = await this.connectionRepository.findOne({
      where: { automationId, targetNodeId: reminderNode.id },
    });
    if (inbound) {
      const source = await this.nodeRepository.findOne({
        where: { id: inbound.sourceNodeId, automationId },
      });
      if (source?.type === AutomationNodeType.WAIT) {
        return source;
      }
    }

    const waitNodes = await this.nodeRepository.find({
      where: { automationId, type: AutomationNodeType.WAIT },
      order: { order: 'DESC', id: 'ASC' },
    });
    return waitNodes.find((node) => node.order < reminderNode.order) ?? null;
  }

  async findPrepaidLoopRestartNode(
    automationId: number,
    config: Record<string, unknown>,
  ): Promise<AutomationNode | null> {
    const workflowKind = String(
      config.onFalseLoopWorkflowKind ?? 'prepaid_visit_reminder_wait',
    ).trim();

    if (workflowKind === 'prepaid_visit_reminder_wait') {
      const waitNode = await this.findPrepaidVisitReminderWaitLoopNode(
        automationId,
      );
      if (waitNode) {
        return waitNode;
      }
    }

    if (workflowKind === 'prepaid_visit_reminder') {
      const reminderNode = await this.findPrepaidVisitReminderLoopNode(
        automationId,
      );
      if (reminderNode) {
        return reminderNode;
      }
    }

    if (workflowKind === 'prepaid_payment_actions') {
      return this.findPrepaidFirstEmailLoopNode(automationId);
    }

    const byKind = await this.findNodeByWorkflowKind(
      automationId,
      workflowKind,
    );
    if (byKind) {
      return byKind;
    }

    return this.findPrepaidVisitReminderWaitLoopNode(automationId);
  }

  async findPaymentReminderLoopRestartNode(
    automationId: number,
    config: Record<string, unknown>,
  ): Promise<AutomationNode | null> {
    const workflowKind = String(
      config.onFalseLoopWorkflowKind ?? 'payment_reminder_email',
    ).trim();

    const byKind = await this.findNodeByWorkflowKind(
      automationId,
      workflowKind,
    );
    if (byKind) {
      return byKind;
    }

    const nodes = await this.nodeRepository.find({
      where: { automationId, type: AutomationNodeType.EMAIL },
      order: { order: 'ASC', id: 'ASC' },
    });
    return nodes[0] ?? null;
  }

  async findById(id: number): Promise<AutomationExecution> {
    const execution = await this.executionRepository.findOne({
      where: { id },
      relations: ['automation', 'automation.campaign', 'currentNode', 'customer'],
    });
    if (!execution) {
      throw new NotFoundException('Automation execution not found');
    }
    return execution;
  }

  private buildExecutionWhere(filters: {
    automationId?: number;
    customerId?: number;
    status?: AutomationExecutionStatus;
  }): FindOptionsWhere<AutomationExecution> {
    const where: FindOptionsWhere<AutomationExecution> = {};

    if (filters.automationId !== undefined) {
      where.automationId = filters.automationId;
    }
    if (filters.customerId !== undefined) {
      where.customerId = filters.customerId;
    }
    if (filters.status !== undefined) {
      where.status = filters.status;
    }

    return where;
  }

  async findExecutionsPaginated(
    filters: {
      automationId?: number;
      customerId?: number;
      status?: AutomationExecutionStatus;
    },
    page?: number,
    limit?: number,
  ): Promise<{ items: AutomationExecution[]; meta: PaginationMeta }> {
    const pagination: PaginationParams = normalizePagination(page, limit);
    const where = this.buildExecutionWhere(filters);

    const [items, total] = await this.executionRepository.findAndCount({
      where,
      relations: ['currentNode', 'customer'],
      order: { createdAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      items,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async getExecutionListSummary(
    automationId: number,
  ): Promise<{ completed: number; inProgress: number }> {
    const completed = await this.executionRepository.count({
      where: {
        automationId,
        status: AutomationExecutionStatus.COMPLETED,
      },
    });
    const inProgress = await this.executionRepository.count({
      where: {
        automationId,
        status: In(this.inProgressExecutionStatuses()),
      },
    });
    return { completed, inProgress };
  }

  async hasCompletedExecutionForCustomer(
    automationId: number,
    customerId: number,
  ): Promise<boolean> {
    return this.executionRepository.exist({
      where: {
        automationId,
        customerId,
        status: AutomationExecutionStatus.COMPLETED,
      },
    });
  }

  private inProgressExecutionStatuses(): AutomationExecutionStatus[] {
    return [
      AutomationExecutionStatus.QUEUED,
      AutomationExecutionStatus.RUNNING,
      AutomationExecutionStatus.WAITING,
      AutomationExecutionStatus.PAUSED,
    ];
  }

  private liveExecutionStatuses(): AutomationExecutionStatus[] {
    return [
      AutomationExecutionStatus.QUEUED,
      AutomationExecutionStatus.RUNNING,
      AutomationExecutionStatus.WAITING,
    ];
  }

  isTerminalExecutionStatus(status: AutomationExecutionStatus): boolean {
    return (
      status === AutomationExecutionStatus.COMPLETED ||
      status === AutomationExecutionStatus.FAILED ||
      status === AutomationExecutionStatus.CANCELLED ||
      status === AutomationExecutionStatus.TIMED_OUT
    );
  }

  async hasActiveExecution(
    automationId: number,
    customerId: number,
  ): Promise<boolean> {
    return this.executionRepository.exist({
      where: {
        automationId,
        customerId,
        status: In(this.liveExecutionStatuses()),
      },
    });
  }

  async hasActiveExecutionForAutomation(automationId: number): Promise<boolean> {
    return this.executionRepository.exist({
      where: {
        automationId,
        status: In(this.liveExecutionStatuses()),
      },
    });
  }

  async hasBlockingBatchSendForAutomation(
    automationId: number,
  ): Promise<boolean> {
    return this.executionRepository.exist({
      where: {
        automationId,
        status: In(this.liveExecutionStatuses()),
      },
    });
  }

  async findActiveExecutionsForCustomer(
    customerId: number,
  ): Promise<AutomationExecution[]> {
    return this.executionRepository.find({
      where: {
        customerId,
        status: In(this.inProgressExecutionStatuses()),
      },
      relations: ['automation'],
    });
  }

  async pauseExecution(executionId: number): Promise<void> {
    const execution = await this.findById(executionId);
    if (
      execution.status === AutomationExecutionStatus.PAUSED ||
      execution.status === AutomationExecutionStatus.COMPLETED ||
      execution.status === AutomationExecutionStatus.FAILED
    ) {
      return;
    }

    const executionContext = {
      ...(execution.executionContext ?? {}),
      pausedFromStatus: execution.status,
      pausedAt: new Date().toISOString(),
    };

    await this.executionRepository.update(executionId, {
      status: AutomationExecutionStatus.PAUSED,
      executionContext: executionContext as object,
    });
  }

  async pauseInProgressExecutionsForAutomation(
    automationId: number,
  ): Promise<number[]> {
    const executions = await this.executionRepository.find({
      where: {
        automationId,
        status: In([
          AutomationExecutionStatus.QUEUED,
          AutomationExecutionStatus.RUNNING,
          AutomationExecutionStatus.WAITING,
        ]),
      },
    });

    const pausedIds: number[] = [];
    for (const execution of executions) {
      const executionContext = {
        ...(execution.executionContext ?? {}),
        pausedFromStatus: execution.status,
        pausedAt: new Date().toISOString(),
      };

      await this.executionRepository.update(execution.id, {
        status: AutomationExecutionStatus.PAUSED,
        executionContext: executionContext as object,
      });
      pausedIds.push(execution.id);
    }

    return pausedIds;
  }

  async findPausedExecutionsForAutomation(
    automationId: number,
  ): Promise<AutomationExecution[]> {
    return this.executionRepository.find({
      where: {
        automationId,
        status: AutomationExecutionStatus.PAUSED,
      },
      relations: ['automation', 'currentNode', 'customer'],
      order: { id: 'ASC' },
    });
  }

  async findOpenExecutionIdsForAutomation(
    automationId: number,
  ): Promise<number[]> {
    const rows = await this.executionRepository.find({
      where: {
        automationId,
        status: In([
          AutomationExecutionStatus.QUEUED,
          AutomationExecutionStatus.RUNNING,
          AutomationExecutionStatus.WAITING,
          AutomationExecutionStatus.PAUSED,
        ]),
      },
      select: ['id'],
      order: { id: 'ASC' },
    });
    return rows.map((row) => row.id);
  }

  async clearPauseState(
    executionId: number,
    status: AutomationExecutionStatus,
    scheduledAt: Date | null,
  ): Promise<void> {
    const execution = await this.findById(executionId);
    const executionContext = { ...(execution.executionContext ?? {}) };
    delete executionContext.pausedFromStatus;
    delete executionContext.pausedAt;

    await this.executionRepository.update(executionId, {
      status,
      scheduledAt,
      executionContext: executionContext as object,
    });
  }

  async findPostVisitEntryNodeId(automationId: number): Promise<number | null> {
    const visitGateOrder = await this.findCustomerVisitedGateOrder(automationId);
    if (visitGateOrder == null) {
      return null;
    }

    const visitGate = await this.nodeRepository.findOne({
      where: { automationId, order: visitGateOrder },
    });
    if (!visitGate) {
      return null;
    }

    const connection = await this.connectionRepository.findOne({
      where: { automationId, sourceNodeId: visitGate.id },
    });
    return connection?.targetNodeId ?? null;
  }

  isExecutionPastVisitGate(execution: AutomationExecution): boolean {
    const config = execution.currentNode?.config ?? {};
    if (String(config.flowBranch ?? '').trim() === 'visited_yes') {
      return true;
    }
    return false;
  }

  async isExecutionPastVisitGateAsync(
    execution: AutomationExecution,
  ): Promise<boolean> {
    if (this.isExecutionPastVisitGate(execution)) {
      return true;
    }

    const visitGateOrder = await this.findCustomerVisitedGateOrder(
      execution.automationId,
    );
    const currentOrder = execution.currentNode?.order;
    if (visitGateOrder == null || currentOrder == null) {
      return false;
    }

    return currentOrder > visitGateOrder;
  }

  async findPrepaidExecutionsForVisitResume(
    customerId: number,
    campaignId: number,
  ): Promise<AutomationExecution[]> {
    const executions = await this.executionRepository.find({
      where: {
        customerId,
        status: In([
          AutomationExecutionStatus.QUEUED,
          AutomationExecutionStatus.RUNNING,
          AutomationExecutionStatus.WAITING,
          AutomationExecutionStatus.COMPLETED,
        ]),
      },
      relations: ['automation', 'currentNode'],
    });

    return executions.filter((execution) => {
      if (execution.automation?.purpose !== AutomationPurpose.FUNNEL_PAYMENT) {
        return false;
      }
      return execution.automation?.campaignId === campaignId;
    });
  }

  async findPrepaidVisitGateExecutionsForCustomer(
    customerId: number,
    campaignId: number,
    statuses: AutomationExecutionStatus[],
  ): Promise<AutomationExecution[]> {
    if (statuses.length === 0) {
      return [];
    }

    const executions = await this.executionRepository.find({
      where: {
        customerId,
        status: In(statuses),
      },
      relations: ['automation', 'currentNode'],
    });

    return executions.filter((execution) => {
      if (execution.automation?.purpose !== AutomationPurpose.FUNNEL_PAYMENT) {
        return false;
      }
      if (execution.automation?.campaignId !== campaignId) {
        return false;
      }
      if (execution.currentNode?.type !== AutomationNodeType.CONDITION) {
        return false;
      }

      const config = execution.currentNode.config ?? {};
      const conditionType = String(
        config.conditionType ?? config.type ?? '',
      ).trim();
      return isCustomerVisitedCondition(conditionType);
    });
  }

  async reopenForVisitResume(executionId: number): Promise<AutomationExecution> {
    await this.executionRepository.update(executionId, {
      status: AutomationExecutionStatus.RUNNING,
      lastError: null,
      scheduledAt: null,
    });
    return this.findById(executionId);
  }

  async applyRecoveredState(
    executionId: number,
    state: {
      currentNodeId: number;
      status: AutomationExecutionStatus;
      scheduledAt: Date | null;
      automationVersion: number | null;
      executionContext: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.executionRepository.update(executionId, {
      currentNodeId: state.currentNodeId,
      status: state.status,
      scheduledAt: state.scheduledAt,
      automationVersion: state.automationVersion,
      executionContext: state.executionContext as object,
      lastError: null,
    });
  }

  async updateExecutionContext(
    executionId: number,
    executionContext: Record<string, unknown>,
  ): Promise<void> {
    await this.executionRepository.update(executionId, {
      executionContext: executionContext as object,
    });
  }

  async bumpAutomationVersion(automationId: number): Promise<number> {
    const automation = await this.automationRepository.findOne({
      where: { id: automationId },
      select: ['id', 'version'],
    });
    if (!automation) {
      throw new NotFoundException('Automation not found');
    }
    const nextVersion = (automation.version ?? 1) + 1;
    await this.automationRepository.update(automationId, { version: nextVersion });
    return nextVersion;
  }

  async getNextNodeId(
    automationId: number,
    sourceNodeId: number,
  ): Promise<number | null> {
    const connection = await this.connectionRepository.findOne({
      where: { automationId, sourceNodeId },
    });
    if (!connection?.targetNodeId) {
      return null;
    }
    if (connection.targetNodeId === sourceNodeId) {
      return null;
    }
    return connection.targetNodeId;
  }

  async updateCurrentNode(
    executionId: number,
    nodeId: number,
    status: AutomationExecutionStatus = AutomationExecutionStatus.RUNNING,
    scheduledAt: Date | null = null,
  ): Promise<AutomationExecution> {
    await this.executionRepository.update(executionId, {
      currentNodeId: nodeId,
      status,
      scheduledAt,
    });
    return this.findById(executionId);
  }

  async updateCustomerId(
    executionId: number,
    customerId: number,
  ): Promise<AutomationExecution> {
    const execution = await this.findById(executionId);
    execution.customerId = customerId;
    return this.executionRepository.save(execution);
  }

  async markCompleted(executionId: number): Promise<AutomationExecution> {
    const execution = await this.findById(executionId);
    execution.status = AutomationExecutionStatus.COMPLETED;
    execution.scheduledAt = null;
    execution.completedAt = new Date();
    if (!execution.startedAt) {
      execution.startedAt = execution.createdAt;
    }
    const saved = await this.executionRepository.save(execution);

    await this.pusherService.notifyExecutionCompleted(
      this.pusherService.buildExecutionTerminalPayload(saved),
    );

    return saved;
  }

  async deleteById(id: number): Promise<void> {
    const execution = await this.findById(id);
    await this.executionRepository.remove(execution);
  }

  async markFailed(
    executionId: number,
    error?: string,
  ): Promise<AutomationExecution> {
    const execution = await this.findById(executionId);
    execution.status = AutomationExecutionStatus.FAILED;
    execution.scheduledAt = null;
    execution.completedAt = new Date();
    if (!execution.startedAt) {
      execution.startedAt = execution.createdAt;
    }
    if (error) {
      execution.lastError = error;
    }
    const saved = await this.executionRepository.save(execution);

    await this.pusherService.notifyExecutionFailed(
      this.pusherService.buildExecutionTerminalPayload(saved),
    );

    return saved;
  }

  async markTimedOut(
    executionId: number,
    error?: string,
  ): Promise<AutomationExecution> {
    const execution = await this.findById(executionId);
    if (this.isTerminalExecutionStatus(execution.status)) {
      return execution;
    }
    execution.status = AutomationExecutionStatus.TIMED_OUT;
    execution.scheduledAt = null;
    execution.completedAt = new Date();
    if (!execution.startedAt) {
      execution.startedAt = execution.createdAt;
    }
    execution.lastError =
      error?.trim() || 'Execution timed out while stuck in a non-terminal state';
    return this.executionRepository.save(execution);
  }

  async resolveStartNodeId(automationId: number): Promise<number | null> {
    const triggerNode = await this.nodeRepository.findOne({
      where: { automationId, type: AutomationNodeType.TRIGGER },
      order: { order: 'ASC' },
    });
    if (triggerNode) {
      return triggerNode.id;
    }

    const firstNode = await this.nodeRepository.findOne({
      where: { automationId },
      order: { order: 'ASC' },
    });
    return firstNode?.id ?? null;
  }

  async findExecutionIdsByAutomationId(automationId: number): Promise<number[]> {
    const rows = await this.executionRepository.find({
      where: { automationId },
      select: ['id'],
    });
    return rows.map((row) => row.id);
  }
}
