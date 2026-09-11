import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { FunnelMetaCapiService } from './funnel-meta-capi.service';
import {
  FUNNEL_META_CAPI_QUEUE,
  FunnelMetaCapiJobName,
  type FunnelMetaCapiJobPayload,
} from './funnel-meta-tracking-queue.constants';
import { FunnelMetaTrackingService } from './funnel-meta-tracking.service';

@Processor(FUNNEL_META_CAPI_QUEUE, { concurrency: 5 })
export class FunnelMetaTrackingQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(FunnelMetaTrackingQueueProcessor.name);

  constructor(
    private readonly trackingService: FunnelMetaTrackingService,
    private readonly capiService: FunnelMetaCapiService,
  ) {
    super();
  }

  async process(job: Job<FunnelMetaCapiJobPayload>): Promise<void> {
    if (job.name !== FunnelMetaCapiJobName.SEND_EVENT) {
      this.logger.warn(`Ignoring unknown funnel meta job name=${job.name}`);
      return;
    }

    const { eventRowId, eventId } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.log(
      `Funnel CAPI job ${job.id}: event_id=${eventId} attempt=${attempt}`,
    );

    try {
      await this.trackingService.processSend(eventRowId, attempt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const maxAttempts = job.opts.attempts ?? 1;

      if (!this.capiService.isRetryableError(err)) {
        await this.trackingService.markDeadLetter(eventRowId, message);
        throw new UnrecoverableError(message);
      }

      if (attempt >= maxAttempts) {
        await this.trackingService.markDeadLetter(eventRowId, message);
      }

      this.logger.warn(
        `Transient funnel CAPI failure event_id=${eventId}: ${message}`,
      );
      throw err;
    }
  }
}
