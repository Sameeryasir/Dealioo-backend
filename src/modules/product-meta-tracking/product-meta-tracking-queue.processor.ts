import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { ProductMetaCapiService } from './product-meta-capi.service';
import {
  PRODUCT_META_CAPI_QUEUE,
  ProductMetaCapiJobName,
  type ProductMetaCapiJobPayload,
} from './product-meta-tracking-queue.constants';
import { ProductMetaTrackingService } from './product-meta-tracking.service';

@Processor(PRODUCT_META_CAPI_QUEUE, { concurrency: 5 })
export class ProductMetaTrackingQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ProductMetaTrackingQueueProcessor.name);

  constructor(
    private readonly trackingService: ProductMetaTrackingService,
    private readonly capiService: ProductMetaCapiService,
  ) {
    super();
  }

  async process(job: Job<ProductMetaCapiJobPayload>): Promise<void> {
    if (job.name !== ProductMetaCapiJobName.SEND_EVENT) {
      this.logger.warn(`Ignoring unknown product meta job name=${job.name}`);
      return;
    }

    const { eventRowId, eventId } = job.data;
    const attempt = job.attemptsMade + 1;
    this.logger.log(
      `Product CAPI job ${job.id}: event_id=${eventId} attempt=${attempt}`,
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
        `Transient product CAPI failure event_id=${eventId}: ${message}`,
      );
      throw err;
    }
  }
}
