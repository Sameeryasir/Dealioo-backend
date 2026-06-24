import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  AUTOMATION_QUEUE,
  AUTOMATION_JOB_CLEANUP_OPTIONS,
  AutomationJobName,
  automationCronSchedulerKey,
} from './automation-queue.constants';
import type {
  CronTickJob,
  ProcessExecutionJob,
  ResumeExecutionJob,
  UnpaidReminderBatchJob,
  UnpaidReminderBatchPhase,
} from './automation-queue.types';
import { unpaidReminderBatchJobId } from './automation-queue.types';

@Injectable()
export class AutomationQueueService {
  constructor(
    @InjectQueue(AUTOMATION_QUEUE)
    private readonly queue: Queue,
  ) {}

  async addUnpaidReminderBatch(
    data: UnpaidReminderBatchJob,
    delayMs = 0,
  ): Promise<string> {
    const phase = data.batchPhase ?? 'payment';
    const jobId = unpaidReminderBatchJobId(data.executionId, phase);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'completed'
      ) {
        return jobId;
      }
      await existing.remove();
    }

    const job = await this.queue.add(
      AutomationJobName.UNPAID_REMINDER_BATCH,
      data,
      {
        jobId,
        attempts: 1,
        ...(delayMs > 0 ? { delay: delayMs } : {}),
        ...AUTOMATION_JOB_CLEANUP_OPTIONS,
      },
    );
    return job.id ?? jobId;
  }

  async removeUnpaidReminderBatchJob(
    executionId: number,
    phase: UnpaidReminderBatchPhase = 'pass',
  ): Promise<void> {
    const job = await this.queue.getJob(
      unpaidReminderBatchJobId(executionId, phase),
    );
    if (job) {
      await job.remove();
    }
  }

  async addProcessExecution(data: ProcessExecutionJob): Promise<string> {
    const job = await this.queue.add(AutomationJobName.PROCESS_EXECUTION, data, {
      jobId: `process-execution-${data.executionId}-${data.nodeId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
      ...AUTOMATION_JOB_CLEANUP_OPTIONS,
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
      ...AUTOMATION_JOB_CLEANUP_OPTIONS,
    });
    return job.id ?? '';
  }

  async removeResumeExecutionJob(executionId: number): Promise<void> {
    const job = await this.queue.getJob(`resume-execution-${executionId}`);
    if (job) {
      await job.remove();
    }
  }

  async upsertCronSchedule(
    automationId: number,
    intervalMs: number,
  ): Promise<void> {
    const schedulerKey = automationCronSchedulerKey(automationId);
    const schedulers = await this.queue.getJobSchedulers();
    const existing = schedulers.find((entry) => entry.key === schedulerKey);
    const intervalChanged =
      existing != null && Number(existing.every) !== intervalMs;
    const isFirstSchedule = existing == null;

    if (intervalChanged) {
      await this.removeCronSchedule(automationId);
    }

    await this.queue.upsertJobScheduler(
      schedulerKey,
      {
        every: intervalMs,
        ...(isFirstSchedule || intervalChanged
          ? { startDate: Date.now() + intervalMs }
          : {}),
      },
      {
        name: AutomationJobName.CRON_TICK,
        data: { automationId } satisfies CronTickJob,
        opts: AUTOMATION_JOB_CLEANUP_OPTIONS,
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
