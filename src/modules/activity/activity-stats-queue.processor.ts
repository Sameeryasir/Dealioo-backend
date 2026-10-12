import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ActivityService } from './activity.service';
import { ActivityStatsQueueService } from './activity-stats-queue.service';
import {
  ACTIVITY_STATS_QUEUE,
  ActivityStatsJobName,
  type ActivityStatsJobPayload,
} from './activity-stats-queue.constants';

@Processor(ACTIVITY_STATS_QUEUE, { concurrency: 2 })
export class ActivityStatsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ActivityStatsQueueProcessor.name);

  constructor(
    private readonly activityService: ActivityService,
    private readonly activityStatsQueueService: ActivityStatsQueueService,
  ) {
    super();
  }

  async process(job: Job<ActivityStatsJobPayload>): Promise<unknown> {
    const payload = job.data;
    this.logger.debug(
      `Computing activity stats kind=${payload.kind} key=${payload.cacheKey}`,
    );

    let result: unknown;
    switch (payload.kind) {
      case ActivityStatsJobName.SUMMARY_MONTHLY:
        result = await this.activityService.computeBusinessSummaryMonthly(
          payload.businessId,
          payload.monthCount,
        );
        break;
      case ActivityStatsJobName.SUMMARY_RANGE:
        result = await this.activityService.computeBusinessSummaryForRange(
          payload.businessId,
          new Date(payload.fromIso),
          new Date(payload.toIso),
          payload.timeZone,
        );
        break;
      default:
        this.logger.warn(
          `Ignoring unknown activity stats job name=${job.name}`,
        );
        return null;
    }

    await this.activityStatsQueueService.persistResult(payload.cacheKey, result);
    return result;
  }
}
