import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
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
      status: AutomationExecutionStatus.RUNNING,
      scheduledAt: null,
    });

    return this.executionRepository.save(execution);
  }

  async findById(id: number): Promise<AutomationExecution> {
    const execution = await this.executionRepository.findOne({
      where: { id },
      relations: ['automation', 'currentNode', 'customer'],
    });
    if (!execution) {
      throw new NotFoundException('Automation execution not found');
    }
    return execution;
  }

  async findExecutions(filters: {
    automationId?: number;
    customerId?: number;
    status?: AutomationExecutionStatus;
  }): Promise<AutomationExecution[]> {
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

    return this.executionRepository.find({
      where,
      relations: ['automation', 'currentNode', 'customer'],
      order: { createdAt: 'DESC' },
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
    return connection?.targetNodeId ?? null;
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

  async markFailed(
    executionId: number,
    error?: string,
  ): Promise<AutomationExecution> {
    const execution = await this.findById(executionId);
    execution.status = AutomationExecutionStatus.FAILED;
    execution.scheduledAt = null;
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
