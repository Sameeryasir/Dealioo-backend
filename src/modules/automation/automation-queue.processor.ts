import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AUTOMATION_QUEUE,
  AutomationJobName,
} from './automation-queue.constants';
import type {
  CronTickJob,
  ProcessExecutionJob,
  ResumeExecutionJob,
  UnpaidReminderBatchJob,
} from './automation-queue.types';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationService } from './automation.service';

@Processor(AUTOMATION_QUEUE, { concurrency: 2 })
export class AutomationQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationQueueProcessor.name);

  constructor(
    private readonly automationService: AutomationService,
    private readonly engineService: AutomationEngineService,
    private readonly executionService: AutomationExecutionService,
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
      this.logger.error(
        `Failed job ${job.name} (${job.id})${executionId ? ` execution=${executionId}` : ''}: ${message}`,
      );
      if (executionId) {
        await this.executionService.markFailed(executionId, message);
      }
      throw error;
    }
  }
}
