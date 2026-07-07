import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AutomationDeadLetter,
  AutomationDeadLetterStatus,
} from '../../db/entities/automation-dead-letter.entity';
import { AutomationNodeType } from '../../db/entities/automation-node.entity';
import type { ProcessExecutionJob } from './automation-queue.types';
import { AutomationJobName } from './automation-queue.constants';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationQueueService } from './automation-queue.service';

@Injectable()
export class AutomationDeadLetterService {
  constructor(
    @InjectRepository(AutomationDeadLetter)
    private readonly deadLetterRepository: Repository<AutomationDeadLetter>,
    private readonly executionService: AutomationExecutionService,
    private readonly queueService: AutomationQueueService,
  ) {}

  async recordFailedJob(params: {
    jobName: string;
    jobId: string;
    jobData: Record<string, unknown>;
    error: string;
    attempts: number;
    executionId?: number | null;
    automationId?: number | null;
    customerId?: number | null;
    nodeId?: number | null;
    nodeType?: string | null;
  }): Promise<AutomationDeadLetter> {
    const entry = this.deadLetterRepository.create({
      executionId: params.executionId ?? null,
      automationId: params.automationId ?? null,
      customerId: params.customerId ?? null,
      jobName: params.jobName,
      jobId: params.jobId,
      jobData: params.jobData,
      nodeId: params.nodeId ?? null,
      nodeType: params.nodeType ?? null,
      error: params.error,
      attempts: params.attempts,
      status: AutomationDeadLetterStatus.PENDING,
    });

    return this.deadLetterRepository.save(entry);
  }

  async listPending(limit = 50): Promise<AutomationDeadLetter[]> {
    return this.deadLetterRepository.find({
      where: { status: AutomationDeadLetterStatus.PENDING },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async retryDeadLetter(id: number): Promise<{ jobId: string }> {
    const entry = await this.deadLetterRepository.findOne({ where: { id } });
    if (!entry) {
      throw new NotFoundException('Dead-letter entry not found');
    }
    if (entry.status !== AutomationDeadLetterStatus.PENDING) {
      throw new NotFoundException('Dead-letter entry is not pending retry');
    }

    let jobId = '';

    if (entry.jobName === AutomationJobName.PROCESS_EXECUTION) {
      const data = entry.jobData as ProcessExecutionJob;
      if (!data.executionId || !data.nodeId) {
        throw new NotFoundException('Invalid process-execution job payload');
      }

      const execution = await this.executionService.findById(data.executionId);
      await this.executionService.markProcessing(data.executionId);

      const nodeType =
        (entry.nodeType as AutomationNodeType | undefined) ??
        (await this.executionService.findNodeForAutomation(
          execution.automationId,
          data.nodeId,
        )).type;

      jobId = await this.queueService.addProcessExecution({
        executionId: data.executionId,
        nodeId: data.nodeId,
        nodeType,
      });
    } else if (entry.jobName === AutomationJobName.RESUME_EXECUTION) {
      const executionId = Number(entry.jobData.executionId);
      if (!Number.isFinite(executionId)) {
        throw new NotFoundException('Invalid resume-execution job payload');
      }
      await this.executionService.markProcessing(executionId);
      jobId = await this.queueService.addResumeExecution({ executionId }, 0);
    } else {
      throw new NotFoundException(
        `Retry not supported for job type ${entry.jobName}`,
      );
    }

    entry.status = AutomationDeadLetterStatus.RETRIED;
    entry.retriedAt = new Date();
    await this.deadLetterRepository.save(entry);

    return { jobId };
  }

  async discardDeadLetter(id: number): Promise<void> {
    const entry = await this.deadLetterRepository.findOne({ where: { id } });
    if (!entry) {
      throw new NotFoundException('Dead-letter entry not found');
    }
    entry.status = AutomationDeadLetterStatus.DISCARDED;
    await this.deadLetterRepository.save(entry);
  }
}
