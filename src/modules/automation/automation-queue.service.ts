import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AutomationNodeType } from '../../db/entities/automation-node.entity';
import {
  AUTOMATION_QUEUE,
  AUTOMATION_JOB_CLEANUP_OPTIONS,
  AutomationJobName,
  automationCronSchedulerKey,
} from './automation-queue.constants';
import {
  resolveProcessExecutionRetryPolicy,
  resolveResumeExecutionRetryPolicy,
} from './automation-node-retry.policy';
import { shouldUseDbWaitScheduler } from './automation-wait-scheduler.constants';
import type {
  CronTickJob,
  ProcessExecutionJob,
  ResumeExecutionJob,
  UnpaidReminderBatchJob,
  UnpaidReminderBatchPhase,
} from './automation-queue.types';
import {
  unpaidReminderBatchJobId,
  unpaidReminderBatchJobIdPrefix,
} from './automation-queue.types';

const QUEUE_JOB_SCAN_STATES = [
  'waiting',
  'delayed',
  'active',
  'paused',
  'prioritized',
  'waiting-children',
] as const;

const UNPAID_CHUNK_COORD_TTL_SEC = 7 * 24 * 60 * 60;
const UNPAID_SEND_LOCK_TTL_SEC = 7 * 24 * 60 * 60;

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
    const chunkIndex = data.chunkIndex ?? 0;
    const jobId = unpaidReminderBatchJobId(data.executionId, phase, chunkIndex);
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

  async setUnpaidReminderChunkTotal(
    executionId: number,
    phase: UnpaidReminderBatchPhase,
    totalChunks: number,
  ): Promise<void> {
    const client = await this.queue.client;
    const key = this.unpaidChunkTotalKey(executionId, phase);
    await client.set(key, String(Math.max(0, totalChunks)), 'EX', UNPAID_CHUNK_COORD_TTL_SEC);
  }

  async getUnpaidReminderChunkProgress(
    executionId: number,
    phase: UnpaidReminderBatchPhase,
  ): Promise<{ done: number; total: number }> {
    const client = await this.queue.client;
    const [doneRaw, totalRaw] = await Promise.all([
      client.get(this.unpaidChunkDoneKey(executionId, phase)),
      client.get(this.unpaidChunkTotalKey(executionId, phase)),
    ]);
    return {
      done: Number(doneRaw ?? 0) || 0,
      total: Number(totalRaw ?? 0) || 0,
    };
  }

  async tryClaimUnpaidPhaseFinalize(
    executionId: number,
    phase: UnpaidReminderBatchPhase,
  ): Promise<boolean> {
    const client = await this.queue.client;
    const key = `unpaid-reminder-phase-final:${executionId}:${phase}`;
    const result = await client.set(
      key,
      '1',
      'EX',
      UNPAID_CHUNK_COORD_TTL_SEC,
      'NX',
    );
    return result === 'OK';
  }

  async recordUnpaidChunkCompleted(
    executionId: number,
    phase: UnpaidReminderBatchPhase,
    fallbackTotalChunks: number,
  ): Promise<{ done: number; total: number; isLast: boolean }> {
    const client = await this.queue.client;
    const doneKey = this.unpaidChunkDoneKey(executionId, phase);
    const done = await client.incr(doneKey);
    await client.expire(doneKey, UNPAID_CHUNK_COORD_TTL_SEC);

    const totalRaw = await client.get(this.unpaidChunkTotalKey(executionId, phase));
    const total = Math.max(
      1,
      Number(totalRaw ?? fallbackTotalChunks) || fallbackTotalChunks || 1,
    );

    if (done < total) {
      return { done, total, isLast: false };
    }

    const claimed = await this.tryClaimUnpaidPhaseFinalize(executionId, phase);
    return { done, total, isLast: claimed };
  }

  async tryAcquireUnpaidReminderSendLock(
    funnelId: number,
    customerId: number,
    executionId: number,
    phase: UnpaidReminderBatchPhase = 'payment',
  ): Promise<boolean> {
    const client = await this.queue.client;
    const key = `unpaid-reminder-send:${funnelId}:${customerId}:${executionId}:${phase}`;
    const result = await client.set(
      key,
      '1',
      'EX',
      UNPAID_SEND_LOCK_TTL_SEC,
      'NX',
    );
    return result === 'OK';
  }

  async removeUnpaidReminderBatchJob(
    executionId: number,
    phase: UnpaidReminderBatchPhase = 'pass',
  ): Promise<void> {
    const prefix = unpaidReminderBatchJobIdPrefix(executionId, phase);
    const legacyId = `unpaid-reminder-batch-${executionId}-${phase}`;

    const legacy = await this.queue.getJob(legacyId);
    if (legacy) {
      await this.safeRemoveJob(legacy);
    }

    for (const state of QUEUE_JOB_SCAN_STATES) {
      let start = 0;
      const batchSize = 100;
      while (true) {
        const jobs = await this.queue.getJobs(state, start, start + batchSize - 1);
        if (jobs.length === 0) {
          break;
        }
        for (const job of jobs) {
          const jobId = String(job.id ?? '');
          if (jobId.startsWith(prefix)) {
            await this.safeRemoveJob(job);
          }
        }
        if (jobs.length < batchSize) {
          break;
        }
        start += batchSize;
      }
    }
  }

  async addProcessExecution(data: ProcessExecutionJob): Promise<string> {
    const nodeType = data.nodeType as AutomationNodeType | undefined;
    const retry = resolveProcessExecutionRetryPolicy(nodeType);
    const job = await this.queue.add(AutomationJobName.PROCESS_EXECUTION, data, {
      jobId: `process-execution-${data.executionId}-${data.nodeId}`,
      attempts: retry.attempts,
      ...(retry.backoff ? { backoff: retry.backoff } : {}),
      ...AUTOMATION_JOB_CLEANUP_OPTIONS,
    });
    return job.id ?? '';
  }

  async addResumeExecution(
    data: ResumeExecutionJob,
    delayMs: number,
  ): Promise<string> {
    if (shouldUseDbWaitScheduler(delayMs)) {
      return `db-wait-${data.executionId}`;
    }

    const retry = resolveResumeExecutionRetryPolicy();
    const job = await this.queue.add(AutomationJobName.RESUME_EXECUTION, data, {
      jobId: `resume-execution-${data.executionId}`,
      delay: delayMs,
      attempts: retry.attempts,
      ...(retry.backoff ? { backoff: retry.backoff } : {}),
      ...AUTOMATION_JOB_CLEANUP_OPTIONS,
    });
    return job.id ?? '';
  }

  async hasPendingResumeJob(executionId: number): Promise<boolean> {
    const job = await this.queue.getJob(`resume-execution-${executionId}`);
    if (!job) {
      return false;
    }
    const state = await job.getState();
    return (
      state === 'active' ||
      state === 'waiting' ||
      state === 'delayed' ||
      state === 'prioritized'
    );
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

  async purgeExecutionJobs(executionIds: number[]): Promise<void> {
    if (executionIds.length === 0) {
      return;
    }

    const executionIdSet = new Set(executionIds);
    for (const executionId of executionIds) {
      await this.removeUnpaidReminderBatchJob(executionId, 'payment');
      await this.removeUnpaidReminderBatchJob(executionId, 'pass');
      await this.removeResumeExecutionJob(executionId);
    }

    for (const state of QUEUE_JOB_SCAN_STATES) {
      let start = 0;
      const batchSize = 100;

      while (true) {
        const jobs = await this.queue.getJobs(state, start, start + batchSize - 1);
        if (jobs.length === 0) {
          break;
        }

        for (const job of jobs) {
          if (this.jobBelongsToExecution(job, executionIdSet)) {
            await this.safeRemoveJob(job);
          }
        }

        if (jobs.length < batchSize) {
          break;
        }
        start += batchSize;
      }
    }
  }

  async purgeAutomationJobs(
    automationId: number,
    executionIds: number[],
  ): Promise<void> {
    await this.removeCronSchedule(automationId);

    const executionIdSet = new Set(executionIds);
    for (const executionId of executionIds) {
      await this.removeUnpaidReminderBatchJob(executionId, 'payment');
      await this.removeUnpaidReminderBatchJob(executionId, 'pass');
      await this.removeResumeExecutionJob(executionId);
    }

    for (const state of QUEUE_JOB_SCAN_STATES) {
      let start = 0;
      const batchSize = 100;

      while (true) {
        const jobs = await this.queue.getJobs(state, start, start + batchSize - 1);
        if (jobs.length === 0) {
          break;
        }

        for (const job of jobs) {
          if (this.jobBelongsToAutomation(job, automationId, executionIdSet)) {
            await this.safeRemoveJob(job);
          }
        }

        if (jobs.length < batchSize) {
          break;
        }
        start += batchSize;
      }
    }
  }

  private unpaidChunkTotalKey(
    executionId: number,
    phase: UnpaidReminderBatchPhase,
  ): string {
    return `unpaid-reminder-chunks-total:${executionId}:${phase}`;
  }

  private unpaidChunkDoneKey(
    executionId: number,
    phase: UnpaidReminderBatchPhase,
  ): string {
    return `unpaid-reminder-chunks-done:${executionId}:${phase}`;
  }

  private jobBelongsToExecution(
    job: Job,
    executionIds: Set<number>,
  ): boolean {
    const data = job.data as { executionId?: number };
    if (
      typeof data.executionId === 'number' &&
      executionIds.has(data.executionId)
    ) {
      return true;
    }

    const jobId = String(job.id ?? '');
    for (const executionId of executionIds) {
      if (
        jobId.startsWith(`process-execution-${executionId}-`) ||
        jobId.startsWith(`resume-execution-${executionId}`) ||
        jobId.startsWith(`unpaid-reminder-batch-${executionId}-`)
      ) {
        return true;
      }
    }

    return false;
  }

  private jobBelongsToAutomation(
    job: Job,
    automationId: number,
    executionIds: Set<number>,
  ): boolean {
    if (job.name === AutomationJobName.CRON_TICK) {
      const data = job.data as CronTickJob;
      return data.automationId === automationId;
    }

    return this.jobBelongsToExecution(job, executionIds);
  }

  private async safeRemoveJob(job: Job): Promise<void> {
    try {
      const state = await job.getState();
      if (state === 'active') {
        await job.discard();
      }
      await job.remove();
    } catch {
    }
  }
}
