import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AutomationNodeType } from '../../db/entities/automation-node.entity';
import {
  AUTOMATION_JOURNEY_QUEUE,
  AUTOMATION_SEND_QUEUE,
  AUTOMATION_JOB_CLEANUP_OPTIONS,
  AutomationJobName,
  automationCronSchedulerKey,
  resolveAutomationCronStartOffsetMs,
  resolveAutomationCronTickConcurrency,
} from './automation-queue.constants';
import {
  resolveProcessExecutionRetryPolicy,
  resolveResumeExecutionRetryPolicy,
} from './automation-node-retry.policy';
import { shouldUseDbWaitScheduler } from './automation-wait-scheduler.constants';
import type {
  ContinueGraphBatchJob,
  CronTickJob,
  HandleFunnelEventJob,
  ProcessExecutionJob,
  PurgeAutomationJobsJob,
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
    @InjectQueue(AUTOMATION_JOURNEY_QUEUE)
    private readonly journeyQueue: Queue,
    @InjectQueue(AUTOMATION_SEND_QUEUE)
    private readonly sendQueue: Queue,
  ) {}

  private get queue(): Queue {
    return this.journeyQueue;
  }

  async addUnpaidReminderBatch(
    data: UnpaidReminderBatchJob,
    delayMs = 0,
  ): Promise<string> {
    const phase = data.batchPhase ?? 'payment';
    const chunkIndex = data.chunkIndex ?? 0;
    const jobId = unpaidReminderBatchJobId(data.executionId, phase, chunkIndex);
    const existing = await this.sendQueue.getJob(jobId);
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

    const job = await this.sendQueue.add(
      AutomationJobName.UNPAID_REMINDER_BATCH,
      data,
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
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
    const client = await this.sendQueue.client;
    const key = this.unpaidChunkTotalKey(executionId, phase);
    await client.set(
      key,
      String(Math.max(0, totalChunks)),
      'EX',
      UNPAID_CHUNK_COORD_TTL_SEC,
    );
  }

  async getUnpaidReminderChunkProgress(
    executionId: number,
    phase: UnpaidReminderBatchPhase,
  ): Promise<{ done: number; total: number }> {
    const client = await this.sendQueue.client;
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
    const client = await this.sendQueue.client;
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
    const client = await this.sendQueue.client;
    const doneKey = this.unpaidChunkDoneKey(executionId, phase);
    const done = await client.incr(doneKey);
    await client.expire(doneKey, UNPAID_CHUNK_COORD_TTL_SEC);

    const totalRaw = await client.get(
      this.unpaidChunkTotalKey(executionId, phase),
    );
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
    const client = await this.sendQueue.client;
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

    for (const target of [this.sendQueue, this.journeyQueue]) {
      const legacy = await target.getJob(legacyId);
      if (legacy) {
        await this.safeRemoveJob(legacy);
      }

      for (const state of QUEUE_JOB_SCAN_STATES) {
        let start = 0;
        const batchSize = 100;
        while (true) {
          const jobs = await target.getJobs(
            state,
            start,
            start + batchSize - 1,
          );
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
  }

  async addContinueGraphBatch(
    data: ContinueGraphBatchJob,
    delayMs = 5_000,
  ): Promise<string> {
    const afterCustomerId = Math.max(0, data.afterCustomerId);
    const jobId = `continue-graph-batch-${data.automationId}-${afterCustomerId}`;
    const existing = await this.journeyQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'prioritized'
      ) {
        return jobId;
      }
      await this.safeRemoveJob(existing);
    }

    const safeDelay = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 5_000;
    const job = await this.journeyQueue.add(
      AutomationJobName.CONTINUE_GRAPH_BATCH,
      data,
      {
        jobId,
        delay: safeDelay,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        ...AUTOMATION_JOB_CLEANUP_OPTIONS,
      },
    );
    return job.id ?? jobId;
  }

  async addProcessExecution(
    data: ProcessExecutionJob,
    delayMs = 0,
    options?: { jobIdSuffix?: string },
  ): Promise<string> {
    const nodeType = data.nodeType as AutomationNodeType | undefined;
    const retry = resolveProcessExecutionRetryPolicy(nodeType);
    const safeDelay = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;
    const suffix = options?.jobIdSuffix?.trim()
      ? `-${options.jobIdSuffix.trim()}`
      : '';
    const jobId = `process-execution-${data.executionId}-${data.nodeId}${suffix}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'prioritized'
      ) {
        return jobId;
      }
      await this.safeRemoveJob(existing);
    }

    const job = await this.queue.add(
      AutomationJobName.PROCESS_EXECUTION,
      data,
      {
        jobId,
        attempts: retry.attempts,
        ...(retry.backoff ? { backoff: retry.backoff } : {}),
        ...(safeDelay > 0 ? { delay: safeDelay } : {}),
        ...AUTOMATION_JOB_CLEANUP_OPTIONS,
      },
    );
    return job.id ?? jobId;
  }

  async addProcessExecutionsBulk(
    items: Array<{
      data: ProcessExecutionJob;
      delayMs?: number;
      jobIdSuffix?: string;
    }>,
  ): Promise<number> {
    if (items.length === 0) {
      return 0;
    }
    if (items.length === 1) {
      const only = items[0];
      await this.addProcessExecution(only.data, only.delayMs ?? 0, {
        jobIdSuffix: only.jobIdSuffix,
      });
      return 1;
    }

    await this.queue.addBulk(
      items.map(({ data, delayMs, jobIdSuffix }) => {
        const nodeType = data.nodeType as AutomationNodeType | undefined;
        const retry = resolveProcessExecutionRetryPolicy(nodeType);
        const safeDelay =
          Number.isFinite(delayMs) && (delayMs ?? 0) > 0 ? delayMs! : 0;
        const suffix = jobIdSuffix?.trim() ? `-${jobIdSuffix.trim()}` : '';
        return {
          name: AutomationJobName.PROCESS_EXECUTION,
          data,
          opts: {
            jobId: `process-execution-${data.executionId}-${data.nodeId}${suffix}`,
            attempts: retry.attempts,
            ...(retry.backoff ? { backoff: retry.backoff } : {}),
            ...(safeDelay > 0 ? { delay: safeDelay } : {}),
            ...AUTOMATION_JOB_CLEANUP_OPTIONS,
          },
        };
      }),
    );
    return items.length;
  }

  async addResumeExecution(
    data: ResumeExecutionJob,
    delayMs: number,
  ): Promise<string> {
    if (shouldUseDbWaitScheduler(delayMs)) {
      return `db-wait-${data.executionId}`;
    }

    const retry = resolveResumeExecutionRetryPolicy();
    const jobId = `resume-execution-${data.executionId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'prioritized'
      ) {
        return jobId;
      }
      await this.safeRemoveJob(existing);
    }

    const job = await this.queue.add(AutomationJobName.RESUME_EXECUTION, data, {
      jobId,
      delay: 0,
      attempts: retry.attempts,
      ...(retry.backoff ? { backoff: retry.backoff } : {}),
      ...AUTOMATION_JOB_CLEANUP_OPTIONS,
    });
    return job.id ?? jobId;
  }

  async addResumeExecutionsBulk(executionIds: number[]): Promise<number> {
    const uniqueIds = [
      ...new Set(executionIds.filter((id) => Number.isFinite(id) && id > 0)),
    ];
    if (uniqueIds.length === 0) {
      return 0;
    }

    const retry = resolveResumeExecutionRetryPolicy();
    await this.queue.addBulk(
      uniqueIds.map((executionId) => ({
        name: AutomationJobName.RESUME_EXECUTION,
        data: { executionId } satisfies ResumeExecutionJob,
        opts: {
          jobId: `resume-execution-${executionId}`,
          delay: 0,
          attempts: retry.attempts,
          ...(retry.backoff ? { backoff: retry.backoff } : {}),
          ...AUTOMATION_JOB_CLEANUP_OPTIONS,
        },
      })),
    );
    return uniqueIds.length;
  }

  async hasPendingResumeJob(executionId: number): Promise<boolean> {
    try {
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
    } catch {
      return false;
    }
  }

  async removeResumeExecutionJob(executionId: number): Promise<void> {
    const job = await this.queue.getJob(`resume-execution-${executionId}`);
    if (job) {
      await job.remove();
    }
  }

  async addHandleFunnelEvent(data: HandleFunnelEventJob): Promise<string> {
    const flags = [
      data.skipCancelPendingOnPayment ? 'skipCancel' : 'cancel',
      data.onlyIfNoExecutionForPayment ? 'onlyIfNone' : 'always',
    ].join('-');
    const jobId = `handle-funnel-event-${data.funnelEventId}-${flags}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === 'active' ||
        state === 'waiting' ||
        state === 'delayed' ||
        state === 'prioritized' ||
        state === 'completed'
      ) {
        return jobId;
      }
      await this.safeRemoveJob(existing);
    }

    const job = await this.queue.add(
      AutomationJobName.HANDLE_FUNNEL_EVENT,
      data,
      {
        jobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        ...AUTOMATION_JOB_CLEANUP_OPTIONS,
      },
    );
    return job.id ?? jobId;
  }

  async tryClaimWaitPollLeadership(
    ownerId: string,
    ttlSec = 15,
  ): Promise<boolean> {
    const client = await this.queue.client;
    const key = 'automation:wait-poll-leader';
    const claimed = await client.set(key, ownerId, 'EX', ttlSec, 'NX');
    if (claimed === 'OK') {
      return true;
    }
    const current = await client.get(key);
    if (current === ownerId) {
      await client.expire(key, ttlSec);
      return true;
    }
    return false;
  }

  async tryAcquireAutomationStartLock(
    automationId: number,
    customerId: number,
    dedupeKey: string,
    ttlSec = 60,
  ): Promise<boolean> {
    const client = await this.queue.client;
    const key = `automation-start:${automationId}:${customerId}:${dedupeKey}`;
    const result = await client.set(key, '1', 'EX', ttlSec, 'NX');
    return result === 'OK';
  }

  /** Drop queued cron-tick jobs so a reschedule does not fire an early rerun. */
  async removePendingCronTickJobs(automationId: number): Promise<number> {
    let removed = 0;

    for (const state of QUEUE_JOB_SCAN_STATES) {
      let start = 0;
      const batchSize = 100;

      while (true) {
        const jobs = await this.queue.getJobs(
          state,
          start,
          start + batchSize - 1,
        );
        if (jobs.length === 0) {
          break;
        }

        for (const job of jobs) {
          if (job.name !== AutomationJobName.CRON_TICK) {
            continue;
          }
          const data = job.data as CronTickJob;
          if (data.automationId !== automationId) {
            continue;
          }
          if (state === 'active') {
            continue;
          }
          await this.safeRemoveJob(job);
          removed += 1;
        }

        if (jobs.length < batchSize) {
          break;
        }
        start += batchSize;
      }
    }

    return removed;
  }

  async upsertCronSchedule(
    automationId: number,
    intervalMs: number,
    options?: { restartFromNow?: boolean },
  ): Promise<Date | null> {
    const schedulerKey = automationCronSchedulerKey(automationId);
    const schedulers = await this.queue.getJobSchedulers();
    const existing = schedulers.find((entry) => entry.key === schedulerKey);
    const intervalChanged =
      existing != null && Number(existing.every) !== intervalMs;
    const restartFromNow = options?.restartFromNow === true;

    if (existing != null && !intervalChanged && !restartFromNow) {
      return null;
    }

    if (intervalChanged || restartFromNow) {
      await this.removePendingCronTickJobs(automationId);
      await this.removeCronSchedule(automationId);
    }

    const repeatEvery = intervalMs;
    const staggerOffsetMs = resolveAutomationCronStartOffsetMs(automationId);
    const nextScheduledAt =
      restartFromNow || intervalChanged || existing == null
        ? Date.now() + repeatEvery + staggerOffsetMs
        : null;

    await this.queue.upsertJobScheduler(
      schedulerKey,
      {
        every: repeatEvery,
        ...(nextScheduledAt != null ? { startDate: nextScheduledAt } : {}),
      },
      {
        name: AutomationJobName.CRON_TICK,
        data: { automationId } satisfies CronTickJob,
        opts: AUTOMATION_JOB_CLEANUP_OPTIONS,
      },
    );

    return nextScheduledAt != null ? new Date(nextScheduledAt) : null;
  }

  async tryAcquireCronTickSlot(ttlSec = 120): Promise<boolean> {
    const max = resolveAutomationCronTickConcurrency();
    if (max < 1) {
      return true;
    }
    const client = await this.queue.client;
    const key = 'automation:cron-tick:inflight';
    const current = Number((await client.get(key)) ?? 0) || 0;
    if (current >= max) {
      return false;
    }
    const next = await client.incr(key);
    await client.expire(key, ttlSec);
    if (next > max) {
      await client.decr(key);
      return false;
    }
    return true;
  }

  async releaseCronTickSlot(): Promise<void> {
    const client = await this.queue.client;
    const key = 'automation:cron-tick:inflight';
    const next = await client.decr(key);
    if (next < 0) {
      await client.set(key, '0', 'EX', 120);
    }
  }

  async requeueCronTick(automationId: number, delayMs: number): Promise<void> {
    const safeDelay = Math.max(1_000, Math.min(delayMs, 60_000));
    await this.queue.add(
      AutomationJobName.CRON_TICK,
      { automationId } satisfies CronTickJob,
      {
        jobId: `cron-tick-retry-${automationId}-${Date.now()}`,
        delay: safeDelay,
        ...AUTOMATION_JOB_CLEANUP_OPTIONS,
      },
    );
  }

  async removeCronSchedule(automationId: number): Promise<void> {
    try {
      await this.queue.removeJobScheduler(
        automationCronSchedulerKey(automationId),
      );
    } catch {}
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

    await this.scanQueuesAndRemove((job) =>
      this.jobBelongsToExecution(job, executionIdSet),
    );
  }

  /**
   * Fast path for delete APIs: stop cron immediately, then enqueue Redis job
   * cleanup so the HTTP request does not wait on thousands of BullMQ removals.
   * Falls back to sync purge if enqueue fails so cleanup always runs.
   * MCP Context 7: prefer async cleanup for durability without blocking clients.
   */
  async enqueuePurgeAutomationJobs(
    automationId: number,
    executionIds: number[],
  ): Promise<void> {
    // --- Stop new cron ticks right away (security) ---
    await this.removeCronSchedule(automationId);

    const payload: PurgeAutomationJobsJob = {
      automationId,
      executionIds,
    };

    try {
      await this.queue.add(AutomationJobName.PURGE_AUTOMATION_JOBS, payload, {
        // Unique id so every delete always gets a cleanup job
        jobId: `purge-automation-jobs-${automationId}-${Date.now()}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    } catch {
      // NOTE: enqueue failed — still purge inline so leftover jobs cannot keep firing
      await this.purgeAutomationJobs(automationId, executionIds);
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

    await this.scanQueuesAndRemove((job) => {
      if (job.name === AutomationJobName.PURGE_AUTOMATION_JOBS) {
        return false;
      }
      return this.jobBelongsToAutomation(job, automationId, executionIdSet);
    });
  }

  private async scanQueuesAndRemove(
    shouldRemove: (job: Job) => boolean,
  ): Promise<void> {
    for (const target of [this.journeyQueue, this.sendQueue]) {
      for (const state of QUEUE_JOB_SCAN_STATES) {
        let start = 0;
        const batchSize = 100;
        while (true) {
          const jobs = await target.getJobs(
            state,
            start,
            start + batchSize - 1,
          );
          if (jobs.length === 0) {
            break;
          }
          for (const job of jobs) {
            if (shouldRemove(job)) {
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

  private jobBelongsToExecution(job: Job, executionIds: Set<number>): boolean {
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
    } catch {}
  }
}
