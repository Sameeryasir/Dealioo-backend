import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Job, Queue, QueueEvents } from 'bullmq';
import { ActivityStatsCacheService } from './activity-stats-cache.service';
import {
  ACTIVITY_STATS_FRESH_MS,
  ACTIVITY_STATS_JOB_OPTIONS,
  ACTIVITY_STATS_QUEUE,
  ACTIVITY_STATS_WAIT_MS,
  type ActivityStatsJobPayload,
} from './activity-stats-queue.constants';

@Injectable()
export class ActivityStatsQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ActivityStatsQueueService.name);
  private readonly queueEvents: QueueEvents;
  private readonly freshMs: number;
  private readonly waitMs: number;

  constructor(
    @InjectQueue(ACTIVITY_STATS_QUEUE)
    private readonly activityStatsQueue: Queue<ActivityStatsJobPayload>,
    private readonly cache: ActivityStatsCacheService,
    configService: ConfigService,
  ) {
    const host = configService.get<string>('REDIS_HOST', '127.0.0.1');
    const port = parseInt(
      configService.get<string>('REDIS_PORT', '6379'),
      10,
    );
    this.queueEvents = new QueueEvents(ACTIVITY_STATS_QUEUE, {
      connection: { host, port },
    });
    const freshRaw = parseInt(
      configService.get<string>(
        'ACTIVITY_STATS_FRESH_MS',
        String(ACTIVITY_STATS_FRESH_MS),
      ),
      10,
    );
    this.freshMs =
      Number.isFinite(freshRaw) && freshRaw > 0
        ? freshRaw
        : ACTIVITY_STATS_FRESH_MS;
    const waitRaw = parseInt(
      configService.get<string>(
        'ACTIVITY_STATS_WAIT_MS',
        String(ACTIVITY_STATS_WAIT_MS),
      ),
      10,
    );
    this.waitMs =
      Number.isFinite(waitRaw) && waitRaw > 0 ? waitRaw : ACTIVITY_STATS_WAIT_MS;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queueEvents.close();
    } catch {
      return;
    }
  }

  jobIdForCacheKey(cacheKey: string): string {
    return createHash('sha1').update(cacheKey).digest('hex');
  }

  async getOrCompute<T>(
    payload: ActivityStatsJobPayload,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const envelope = await this.cache.getEnvelope<T>(payload.cacheKey);
    if (envelope) {
      const ageMs = Date.now() - envelope.computedAt;
      if (ageMs > this.freshMs) {
        void this.enqueueRefresh(payload);
      }
      return envelope.value;
    }

    try {
      return await this.computeViaQueue<T>(payload);
    } catch (error) {
      this.logger.warn(
        `Activity stats queue miss for ${payload.cacheKey}; inline fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const value = await fallback();
      await this.persistResult(payload.cacheKey, value);
      return value;
    }
  }

  async enqueueRefresh(payload: ActivityStatsJobPayload): Promise<void> {
    try {
      await this.addJob(payload);
    } catch (error) {
      this.logger.warn(
        `Activity stats refresh enqueue failed for ${payload.cacheKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async persistResult<T>(cacheKey: string, value: T): Promise<void> {
    await this.cache.set(cacheKey, value);
  }

  private async computeViaQueue<T>(payload: ActivityStatsJobPayload): Promise<T> {
    const job = await this.addJob(payload);
    try {
      const result = (await job.waitUntilFinished(
        this.queueEvents,
        this.waitMs,
      )) as T;
      return result;
    } catch (error) {
      const completed = await this.cache.getEnvelope<T>(payload.cacheKey);
      if (completed) {
        return completed.value;
      }
      throw error;
    }
  }

  private async addJob(
    payload: ActivityStatsJobPayload,
  ): Promise<Job<ActivityStatsJobPayload>> {
    const jobId = this.jobIdForCacheKey(payload.cacheKey);
    const existing = await this.activityStatsQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (
        state === 'waiting' ||
        state === 'active' ||
        state === 'delayed' ||
        state === 'prioritized' ||
        state === 'waiting-children'
      ) {
        return existing;
      }
      if (state === 'completed' || state === 'failed') {
        try {
          await existing.remove();
        } catch {
          // ignore remove races
        }
      }
    }

    try {
      return await this.activityStatsQueue.add(payload.kind, payload, {
        ...ACTIVITY_STATS_JOB_OPTIONS,
        jobId,
      });
    } catch {
      const raced = await this.activityStatsQueue.getJob(jobId);
      if (raced) return raced;
      throw new Error(`Unable to enqueue activity stats job ${jobId}`);
    }
  }
}
