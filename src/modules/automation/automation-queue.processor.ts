import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AUTOMATION_QUEUE,
  AutomationJobName,
} from './automation-queue.constants';
import type {
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
      UnpaidReminderBatchJob | ProcessExecutionJob | ResumeExecutionJob
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
      UnpaidReminderBatchJob | ProcessExecutionJob | ResumeExecutionJob
    >,
  ): Promise<void> {
    this.logger.log(`Processing job ${job.name} (${job.id})`);
    const executionId = this.resolveExecutionId(job);

    try {
      switch (job.name) {
        case AutomationJobName.UNPAID_REMINDER_BATCH:
          await this.automationService.runUnpaidReminderBatch(
            job.data as UnpaidReminderBatchJob,
          );
          return;

        case AutomationJobName.PROCESS_EXECUTION:
          await this.engineService.processExecution(
            (job.data as ProcessExecutionJob).executionId,
          );
          return;

        case AutomationJobName.RESUME_EXECUTION:
          await this.engineService.resumeAfterWait(
            (job.data as ResumeExecutionJob).executionId,
          );
          return;

        default:
          this.logger.warn(`Unknown automation job: ${job.name}`);
      }
    } catch (error) {
      if (executionId) {
        const message =
          error instanceof Error ? error.message : 'Job processing failed';
        await this.executionService.markFailed(executionId, message);
      }
      throw error;
    }
  }
}
