import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  AUTOMATION_QUEUE,
  AutomationJobName,
  automationCronSchedulerKey,
} from './automation-queue.constants';
import type {
  CronTickJob,
  ProcessExecutionJob,
  ResumeExecutionJob,
  UnpaidReminderBatchJob,
} from './automation-queue.types';

@Injectable()
export class AutomationQueueService {
  constructor(
    @InjectQueue(AUTOMATION_QUEUE)
    private readonly queue: Queue,
  ) {}

  async addUnpaidReminderBatch(
    data: UnpaidReminderBatchJob,
  ): Promise<string> {
    const job = await this.queue.add(
      AutomationJobName.UNPAID_REMINDER_BATCH,
      data,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    );
    return job.id ?? '';
  }

  async addProcessExecution(data: ProcessExecutionJob): Promise<string> {
    const job = await this.queue.add(AutomationJobName.PROCESS_EXECUTION, data, {
      jobId: `process-execution-${data.executionId}-${data.nodeId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    return job.id ?? '';
  }

  async addResumeExecution(
    data: ResumeExecutionJob,
    delayMs: number,
  ): Promise<string> {
    const job = await this.queue.add(AutomationJobName.RESUME_EXECUTION, data, {
      jobId: `resume-execution-${data.executionId}`,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    return job.id ?? '';
  }

  async upsertCronSchedule(
    automationId: number,
    intervalMs: number,
  ): Promise<void> {
    const schedulerKey = automationCronSchedulerKey(automationId);
    const schedulers = await this.queue.getJobSchedulers();
    const existing = schedulers.find((entry) => entry.key === schedulerKey);

    if (existing && existing.every !== intervalMs) {
      await this.removeCronSchedule(automationId);
    }

    await this.queue.upsertJobScheduler(
      schedulerKey,
      { every: intervalMs },
      {
        name: AutomationJobName.CRON_TICK,
        data: { automationId } satisfies CronTickJob,
      },
    );
  }

  async removeCronSchedule(automationId: number): Promise<void> {
    try {
      await this.queue.removeJobScheduler(
        automationCronSchedulerKey(automationId),
      );
    } catch {
    }
  }
}
