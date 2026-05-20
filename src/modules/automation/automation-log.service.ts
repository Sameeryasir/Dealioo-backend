import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AutomationLog } from '../../db/entities/automation-log.entity';

export type ExecutionEmailRecipient = {
  customerId: number;
  email: string;
};

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

  async findEmailRecipientsByExecutionIds(
    executionIds: number[],
  ): Promise<Map<number, ExecutionEmailRecipient[]>> {
    const map = new Map<number, ExecutionEmailRecipient[]>();
    if (executionIds.length === 0) {
      return map;
    }

    const logs = await this.automationLogRepository.find({
      where: {
        executionId: In(executionIds),
      },
      order: { createdAt: 'ASC' },
    });

    for (const log of logs) {
      const match = log.message.match(/email sent to (.+)$/i);
      const email = match?.[1]?.trim();
      if (!email) {
        continue;
      }

      const list = map.get(log.executionId) ?? [];
      if (!list.some((entry) => entry.customerId === log.customerId)) {
        list.push({ customerId: log.customerId, email });
        map.set(log.executionId, list);
      }
    }

    return map;
  }
}
