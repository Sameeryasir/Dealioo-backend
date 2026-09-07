import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, NotFoundException } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AUTOMATION_QUEUE,
  AutomationJobName,
  resolveAutomationQueueConcurrency,
  resolveAutomationQueueLimiter,
} from './automation-queue.constants';
import { AutomationNodeType } from '../../db/entities/automation-node.entity';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import type {
  CronTickJob,
  HandleFunnelEventJob,
  ProcessExecutionJob,
  ResumeExecutionJob,
  UnpaidReminderBatchJob,
} from './automation-queue.types';
import { AutomationDeadLetterService } from './automation-dead-letter.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationMetricsService } from './automation-metrics.service';
import { AutomationQueueService } from './automation-queue.service';
import { AutomationService } from './automation.service';
import {
  isLikelyProviderOutageError,
  resolveJobAttempts,
  resolveProviderOutageRetryDelayMs,
} from './automation-node-retry.policy';

const queueLimiter = resolveAutomationQueueLimiter();

@Processor(AUTOMATION_QUEUE, {
  concurrency: resolveAutomationQueueConcurrency(),
  ...(queueLimiter ? { limiter: queueLimiter } : {}),
})
export class AutomationQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationQueueProcessor.name);

  constructor(
    private readonly automationService: AutomationService,
    private readonly engineService: AutomationEngineService,
    private readonly executionService: AutomationExecutionService,
    private readonly deadLetterService: AutomationDeadLetterService,
    private readonly metricsService: AutomationMetricsService,
    private readonly queueService: AutomationQueueService,
  ) {
    super();
  }

  private resolveExecutionId(
    job: Job<
      | UnpaidReminderBatchJob
      | ProcessExecutionJob
      | ResumeExecutionJob
      | CronTickJob
      | HandleFunnelEventJob
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
      | HandleFunnelEventJob
    >,
  ): Promise<void> {
    const executionId = this.resolveExecutionId(job);
    this.logger.log(
      `Processing job ${job.name} (${job.id})${executionId ? ` execution=${executionId}` : ''}`,
    );

    try {
      switch (job.name) {
        case AutomationJobName.CRON_TICK: {
          const automationId = (job.data as CronTickJob).automationId;
          this.logger.log(
            `[PaymentReminderCron] QUEUE JOB RECEIVED automation=${automationId} jobId=${job.id ?? 'unknown'}`,
          );
          await this.automationService.runCronTick(automationId);
          break;
        }

        case AutomationJobName.UNPAID_REMINDER_BATCH:
          await this.automationService.runUnpaidReminderBatch(
            job.data as UnpaidReminderBatchJob,
          );
          break;

        case AutomationJobName.HANDLE_FUNNEL_EVENT: {
          const payload = job.data as HandleFunnelEventJob;
          await this.automationService.handleQueuedFunnelEvent(payload);
          break;
        }

        case AutomationJobName.PROCESS_EXECUTION: {
          const payload = job.data as ProcessExecutionJob;
          await this.engineService.processExecution(
            payload.executionId,
            payload.nodeId,
          );
          break;
        }

        case AutomationJobName.RESUME_EXECUTION: {
          const resumeExecutionId = (job.data as ResumeExecutionJob)
            .executionId;
          const execution =
            await this.executionService.findById(resumeExecutionId);
          const resumePassAfterWait =
            execution.executionContext?.paymentReminderResume ===
              'pass_after_wait' ||
            execution.automation?.purpose ===
              AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER;
          if (resumePassAfterWait) {
            await this.automationService.resumePaymentReminderAfterWait(
              resumeExecutionId,
            );
          } else {
            await this.engineService.resumeAfterWait(resumeExecutionId);
          }
          break;
        }

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

      if (
        executionId &&
        isFinalAttempt &&
        job.name === AutomationJobName.PROCESS_EXECUTION &&
        isLikelyProviderOutageError(message)
      ) {
        const deferred = await this.tryDeferProviderOutageRetry(
          job as Job<ProcessExecutionJob>,
          executionId,
          message,
        );
        if (deferred) {
          return;
        }
      }

      if (executionId && isFinalAttempt) {
        await this.recordDeadLetter(job, executionId, message);
      } else if (executionId && !isFinalAttempt) {
        try {
          await this.executionService.markProcessing(executionId);
        } catch {
        }
      } else if (executionId) {
        try {
          await this.executionService.markFailed(executionId, message);
          this.metricsService.recordExecutionFailed();
        } catch {
        }
      }

      throw error;
    }
  }

  private async tryDeferProviderOutageRetry(
    job: Job<ProcessExecutionJob>,
    executionId: number,
    message: string,
  ): Promise<boolean> {
    try {
      const execution = await this.executionService.findById(executionId);
      const nextAttempt = (execution.attemptNumber ?? 1) + 1;
      if (nextAttempt > 10) {
        return false;
      }

      const delayMs = resolveProviderOutageRetryDelayMs(nextAttempt);
      await this.executionService.scheduleProviderOutageRetry(
        executionId,
        nextAttempt,
        delayMs,
        message,
      );

      const payload = job.data;
      await this.queueService.addProcessExecution(
        {
          executionId: payload.executionId,
          nodeId: payload.nodeId,
          nodeType: payload.nodeType,
        },
        delayMs,
        { jobIdSuffix: `outage-${nextAttempt}` },
      );

      this.logger.warn(
        `Deferred provider-outage retry for execution=${executionId} attempt=${nextAttempt} delayMs=${delayMs}`,
      );
      return true;
    } catch {
      return false;
    }
  }

  private resolveMaxAttempts(
    job: Job<
      | UnpaidReminderBatchJob
      | ProcessExecutionJob
      | ResumeExecutionJob
      | CronTickJob
      | HandleFunnelEventJob
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
    if (job.name === AutomationJobName.HANDLE_FUNNEL_EVENT) {
      return 5;
    }
    return job.opts.attempts ?? 1;
  }

  private async recordDeadLetter(
    job: Job<
      | UnpaidReminderBatchJob
      | ProcessExecutionJob
      | ResumeExecutionJob
      | CronTickJob
      | HandleFunnelEventJob
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
    }
  }
}
