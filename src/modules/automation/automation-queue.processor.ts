import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, NotFoundException } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AUTOMATION_QUEUE,
  AutomationJobName,
  resolveAutomationQueueConcurrency,
} from './automation-queue.constants';
import { AutomationNodeType } from '../../db/entities/automation-node.entity';
import type {
  CronTickJob,
  ProcessExecutionJob,
  ResumeExecutionJob,
  UnpaidReminderBatchJob,
} from './automation-queue.types';
import { AutomationDeadLetterService } from './automation-dead-letter.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationMetricsService } from './automation-metrics.service';
import { AutomationService } from './automation.service';
import { resolveJobAttempts } from './automation-node-retry.policy';

@Processor(AUTOMATION_QUEUE, {
  concurrency: resolveAutomationQueueConcurrency(),
})
export class AutomationQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationQueueProcessor.name);

  constructor(
    private readonly automationService: AutomationService,
    private readonly engineService: AutomationEngineService,
    private readonly executionService: AutomationExecutionService,
    private readonly deadLetterService: AutomationDeadLetterService,
    private readonly metricsService: AutomationMetricsService,
  ) {
    super();
  }

  private resolveExecutionId(
    job: Job<
      | UnpaidReminderBatchJob
      | ProcessExecutionJob
      | ResumeExecutionJob
      | CronTickJob
    >,
  ): number | null {
    const data = job.data;
    if (data && typeof data === 'object' && 'executionId' in data) {
      return (data as { executionId: number }).executionId;
    }
    return null;
  }

  async process(
    job: Job<
      | UnpaidReminderBatchJob
      | ProcessExecutionJob
      | ResumeExecutionJob
      | CronTickJob
    >,
  ): Promise<void> {
    const executionId = this.resolveExecutionId(job);
    this.logger.log(
      `Processing job ${job.name} (${job.id})${executionId ? ` execution=${executionId}` : ''}`,
    );

    try {
      switch (job.name) {
        case AutomationJobName.CRON_TICK:
          await this.automationService.runCronTick(
            (job.data as CronTickJob).automationId,
          );
          break;

        case AutomationJobName.UNPAID_REMINDER_BATCH:
          await this.automationService.runUnpaidReminderBatch(
            job.data as UnpaidReminderBatchJob,
          );
          break;

        case AutomationJobName.PROCESS_EXECUTION: {
          const payload = job.data as ProcessExecutionJob;
          await this.engineService.processExecution(
            payload.executionId,
            payload.nodeId,
          );
          break;
        }

        case AutomationJobName.RESUME_EXECUTION:
          await this.engineService.resumeAfterWait(
            (job.data as ResumeExecutionJob).executionId,
          );
          break;

        default:
          this.logger.warn(`Unknown automation job: ${job.name}`);
      }

      this.logger.log(`Completed job ${job.name} (${job.id})`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Job processing failed';

      if (
        error instanceof NotFoundException &&
        message.includes('Automation execution not found')
      ) {
        this.logger.warn(
          `Skipping stale job ${job.name} (${job.id})${executionId ? ` execution=${executionId}` : ''}: execution was removed`,
        );
        return;
      }

      this.logger.error(
        `Failed job ${job.name} (${job.id})${executionId ? ` execution=${executionId}` : ''}: ${message}`,
      );

      const maxAttempts = this.resolveMaxAttempts(job);
      const isFinalAttempt = job.attemptsMade >= maxAttempts;

      if (executionId && isFinalAttempt) {
        await this.recordDeadLetter(job, executionId, message);
      } else if (executionId && !isFinalAttempt) {
        try {
          await this.executionService.markProcessing(executionId);
        } catch {
          // Execution may have been deleted before markProcessing runs.
        }
      } else if (executionId) {
        try {
          await this.executionService.markFailed(executionId, message);
          this.metricsService.recordExecutionFailed();
        } catch {
          // Execution may have been deleted before markFailed runs.
        }
      }

      throw error;
    }
  }

  private resolveMaxAttempts(
    job: Job<
      | UnpaidReminderBatchJob
      | ProcessExecutionJob
      | ResumeExecutionJob
      | CronTickJob
    >,
  ): number {
    if (job.name === AutomationJobName.PROCESS_EXECUTION) {
      const payload = job.data as ProcessExecutionJob;
      return resolveJobAttempts(
        payload.nodeType as AutomationNodeType | undefined,
        'process-execution',
      );
    }
    if (job.name === AutomationJobName.RESUME_EXECUTION) {
      return resolveJobAttempts(undefined, 'resume-execution');
    }
    return job.opts.attempts ?? 1;
  }

  private async recordDeadLetter(
    job: Job<
      | UnpaidReminderBatchJob
      | ProcessExecutionJob
      | ResumeExecutionJob
      | CronTickJob
    >,
    executionId: number,
    message: string,
  ): Promise<void> {
    try {
      const execution = await this.executionService.findById(executionId);
      const payload = job.data as ProcessExecutionJob;
      await this.deadLetterService.recordFailedJob({
        jobName: job.name,
        jobId: String(job.id ?? ''),
        jobData: job.data as Record<string, unknown>,
        error: message,
        attempts: job.attemptsMade,
        executionId,
        automationId: execution.automationId,
        customerId: execution.customerId,
        nodeId: payload.nodeId ?? execution.currentNodeId,
        nodeType: payload.nodeType ?? execution.currentNode?.type ?? null,
      });
      await this.executionService.markFailed(executionId, message);
      this.metricsService.recordDeadLetter();
      this.metricsService.recordExecutionFailed();
    } catch {
      // Execution may have been deleted before DLQ write runs.
    }
  }
}
