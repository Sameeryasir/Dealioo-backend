import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { FunnelGoogleConversionUploadService } from './funnel-google-conversion-upload.service';
import {
  FUNNEL_GOOGLE_UPLOAD_QUEUE,
  FunnelGoogleUploadJobName,
  type FunnelGoogleUploadJobPayload,
} from './google-funnel-tracking-queue.constants';
import { GoogleFunnelTrackingService } from './google-funnel-tracking.service';

@Processor(FUNNEL_GOOGLE_UPLOAD_QUEUE, { concurrency: 5 })
export class GoogleFunnelTrackingQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(GoogleFunnelTrackingQueueProcessor.name);

  constructor(
    private readonly trackingService: GoogleFunnelTrackingService,
    private readonly uploadService: FunnelGoogleConversionUploadService,
  ) {
    super();
  }

  async process(job: Job<FunnelGoogleUploadJobPayload>): Promise<void> {
    if (job.name !== FunnelGoogleUploadJobName.SEND_EVENT) {
      this.logger.warn(`Ignoring unknown google funnel job name=${job.name}`);
      return;
    }

    const { eventRowId, eventId } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.log(
      `Google upload job ${job.id}: event_id=${eventId} attempt=${attempt}`,
    );

    try {
      await this.trackingService.processSend(eventRowId, attempt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const maxAttempts = job.opts.attempts ?? 1;

      if (!this.uploadService.isRetryableError(err)) {
        await this.trackingService.markDeadLetter(eventRowId, message);
        throw new UnrecoverableError(message);
      }

      if (attempt >= maxAttempts) {
        await this.trackingService.markDeadLetter(eventRowId, message);
      }

      this.logger.warn(
        `Transient Google upload failure event_id=${eventId}: ${message}`,
      );
      throw err;
    }
  }
}
