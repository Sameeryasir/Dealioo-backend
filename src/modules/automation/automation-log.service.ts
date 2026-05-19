import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationLog } from '../../db/entities/automation-log.entity';

@Injectable()
export class AutomationLogService {
  constructor(
    @InjectRepository(AutomationLog)
    private readonly automationLogRepository: Repository<AutomationLog>,
  ) {}

  async createLog(params: {
    executionId: number;
    nodeId: number;
    customerId: number;
    message: string;
    error?: string | null;
  }): Promise<AutomationLog> {
    const log = this.automationLogRepository.create({
      executionId: params.executionId,
      nodeId: params.nodeId,
      customerId: params.customerId,
      message: params.message,
      error: params.error ?? null,
    });
    return this.automationLogRepository.save(log);
  }

  async findByExecutionId(executionId: number): Promise<AutomationLog[]> {
    return this.automationLogRepository.find({
      where: { executionId },
      relations: ['node'],
      order: { createdAt: 'ASC' },
    });
  }

  async findByAutomationId(automationId: number): Promise<AutomationLog[]> {
    return this.automationLogRepository.find({
      where: { execution: { automationId } },
      relations: ['node', 'execution'],
      order: { createdAt: 'DESC' },
    });
  }
}
