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

  async countByExecutionId(executionId: number): Promise<number> {
    return this.automationLogRepository.count({ where: { executionId } });
  }

  async findLastScheduledWaitNodeId(
    executionId: number,
  ): Promise<number | null> {
    const rows = await this.automationLogRepository.find({
      where: { executionId },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    const waitLog = rows.find((entry) =>
      entry.message.startsWith('Delay scheduled'),
    );
    return waitLog?.nodeId ?? null;
  }

  async getVisitedNodeIds(executionId: number): Promise<number[]> {
    const rows = await this.automationLogRepository
      .createQueryBuilder('log')
      .select('DISTINCT log.nodeId', 'nodeId')
      .where('log.executionId = :executionId', { executionId })
      .getRawMany<{ nodeId: string }>();

    return rows
      .map((row) => Number(row.nodeId))
      .filter((id) => Number.isFinite(id));
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

  async hasBatchPhaseEmailSent(
    executionId: number,
    nodeId: number,
    phase: 'payment' | 'pass',
  ): Promise<boolean> {
    const pattern =
      phase === 'pass' ? 'QR pass email sent%' : 'Payment reminder email sent%';

    return this.automationLogRepository
      .createQueryBuilder('log')
      .where('log.executionId = :executionId', { executionId })
      .andWhere('log.nodeId = :nodeId', { nodeId })
      .andWhere('log.message ILIKE :pattern', { pattern })
      .getExists();
  }

  async hasPassFollowUpScheduled(executionId: number): Promise<boolean> {
    return this.automationLogRepository
      .createQueryBuilder('log')
      .where('log.executionId = :executionId', { executionId })
      .andWhere(
        '(log.message ILIKE :wait OR log.message ILIKE :schedule)',
        {
          wait: 'Wait % minute(s) before sending QR pass email',
          schedule: 'Scheduling QR pass email',
        },
      )
      .getExists();
  }

  async countDistinctEmailRecipientsForAutomation(
    automationId: number,
  ): Promise<number> {
    const row = await this.automationLogRepository
      .createQueryBuilder('log')
      .innerJoin('log.execution', 'execution')
      .where('execution.automationId = :automationId', { automationId })
      .andWhere('log.message ILIKE :pattern', { pattern: '%email sent to%' })
      .select('COUNT(DISTINCT log.customerId)', 'count')
      .getRawOne<{ count: string }>();

    return Number(row?.count ?? 0);
  }
}
