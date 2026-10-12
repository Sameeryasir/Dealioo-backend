import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { FunnelEventService } from './funnel-event.service';
import { FunnelStatsQueueService } from './funnel-stats-queue.service';
import {
  FUNNEL_STATS_QUEUE,
  FunnelStatsJobName,
  type FunnelStatsJobPayload,
} from './funnel-stats-queue.constants';

@Processor(FUNNEL_STATS_QUEUE, { concurrency: 2 })
export class FunnelStatsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(FunnelStatsQueueProcessor.name);

  constructor(
    private readonly funnelEventService: FunnelEventService,
    private readonly funnelStatsQueueService: FunnelStatsQueueService,
  ) {
    super();
  }

  async process(job: Job<FunnelStatsJobPayload>): Promise<unknown> {
    const payload = job.data;
    this.logger.debug(
      `Computing funnel stats kind=${payload.kind} key=${payload.cacheKey}`,
    );

    let result: unknown;
    switch (payload.kind) {
      case FunnelStatsJobName.STATS_MONTHLY:
        result = await this.funnelEventService.computeStatsMonthly(
          payload.funnelId,
          payload.monthCount,
        );
        break;
      case FunnelStatsJobName.STATS_RANGE:
        result = await this.funnelEventService.computeStatsForRange(
          payload.funnelId,
          new Date(payload.fromIso),
          new Date(payload.toIso),
          payload.timeZone,
        );
        break;
      case FunnelStatsJobName.GUEST_AD_SOURCES:
        result = await this.funnelEventService.computeFunnelGuestAdSourceCounts(
          payload.funnelId,
          {
            from: payload.from,
            to: payload.to,
            timezone: payload.timezone,
          },
        );
        break;
      case FunnelStatsJobName.STATS_TOTAL:
        result = await this.funnelEventService.computeStats(payload.funnelId);
        break;
      default:
        this.logger.warn(`Ignoring unknown funnel stats job name=${job.name}`);
        return null;
    }

    await this.funnelStatsQueueService.persistResult(payload.cacheKey, result);
    return result;
  }
}
