import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
  type PaginationParams,
} from '../../common/pagination';
import { AutomationConnection } from '../../db/entities/automation-connection.entity';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
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
  ) {}

  async createExecution(
    dto: CreateAutomationExecutionDto,
    customerId: number,
    options?: {
      status?: AutomationExecutionStatus;
      totalRecipients?: number;
    },
  ): Promise<AutomationExecution> {
    const node = await this.nodeRepository.findOne({
      where: { id: dto.currentNodeId, automationId: dto.automationId },
    });
    if (!node) {
      throw new NotFoundException('Start node not found for this automation');
    }

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
    });

    return this.executionRepository.save(execution);
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
      relations: ['automation', 'currentNode', 'customer'],
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
        status: In([
          AutomationExecutionStatus.QUEUED,
          AutomationExecutionStatus.RUNNING,
          AutomationExecutionStatus.WAITING,
        ]),
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

  async hasActiveExecution(
    automationId: number,
    customerId: number,
  ): Promise<boolean> {
    return this.executionRepository.exist({
      where: {
        automationId,
        customerId,
        status: In([
          AutomationExecutionStatus.QUEUED,
          AutomationExecutionStatus.RUNNING,
          AutomationExecutionStatus.WAITING,
        ]),
      },
    });
  }

  async hasActiveExecutionForAutomation(automationId: number): Promise<boolean> {
    return this.executionRepository.exist({
      where: {
        automationId,
        status: In([
          AutomationExecutionStatus.QUEUED,
          AutomationExecutionStatus.RUNNING,
          AutomationExecutionStatus.WAITING,
        ]),
      },
    });
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
    const execution = await this.findById(executionId);
    execution.currentNodeId = nodeId;
    execution.status = status;
    execution.scheduledAt = scheduledAt;
    return this.executionRepository.save(execution);
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
    return this.executionRepository.save(execution);
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
    if (error) {
      execution.lastError = error;
    }
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
}
