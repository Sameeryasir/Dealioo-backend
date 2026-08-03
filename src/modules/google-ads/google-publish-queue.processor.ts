import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import {
  GOOGLE_PUBLISH_QUEUE,
  GooglePublishJobName,
  type GooglePublishJobPayload,
} from './google-publish-queue.constants';
import { isTransientGooglePublishError } from './google-publish-errors.util';
import { GooglePublishService } from './google-publish.service';

@Processor(GOOGLE_PUBLISH_QUEUE, { concurrency: 3 })
export class GooglePublishQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(GooglePublishQueueProcessor.name);

  constructor(private readonly googlePublishService: GooglePublishService) {
    super();
  }

  async process(job: Job<GooglePublishJobPayload>): Promise<void> {
    if (job.name !== GooglePublishJobName.PUBLISH_DRAFT) {
      this.logger.warn(`Ignoring unknown google publish job name=${job.name}`);
      return;
    }

    const { userId, businessId, draftId } = job.data;
    this.logger.log(
      `Google publish job ${job.id}: draft=${draftId} business=${businessId} attempt=${job.attemptsMade + 1}`,
    );

    try {
      await this.googlePublishService.processQueuedPublish(job);
    } catch (err) {
      if (err instanceof UnrecoverableError) {
        throw err;
      }

      if (!isTransientGooglePublishError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Non-retryable google publish failure for draft=${draftId}: ${message}`,
        );
        throw new UnrecoverableError(message);
      }

      this.logger.warn(
        `Transient google publish failure for draft=${draftId}; BullMQ will retry: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }
}
