import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import {
  META_PUBLISH_QUEUE,
  MetaPublishJobName,
  type MetaPublishJobPayload,
} from './meta-publish-queue.constants';
import { isTransientMetaPublishError } from './meta-publish-errors.util';
import { MetaPublishService } from './meta-publish.service';

@Processor(META_PUBLISH_QUEUE, { concurrency: 3 })
export class MetaPublishQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(MetaPublishQueueProcessor.name);

  constructor(private readonly metaPublishService: MetaPublishService) {
    super();
  }

  async process(job: Job<MetaPublishJobPayload>): Promise<void> {
    if (job.name !== MetaPublishJobName.PUBLISH_DRAFT) {
      this.logger.warn(`Ignoring unknown meta publish job name=${job.name}`);
      return;
    }

    const { userId, businessId, draftId } = job.data;
    this.logger.log(
      `Meta publish job ${job.id}: draft=${draftId} business=${businessId} attempt=${job.attemptsMade + 1}`,
    );

    try {
      await this.metaPublishService.processQueuedPublish(job);
    } catch (err) {
      if (err instanceof UnrecoverableError) {
        throw err;
      }

      if (!isTransientMetaPublishError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Non-retryable meta publish failure for draft=${draftId}: ${message}`,
        );
        throw new UnrecoverableError(message);
      }

      this.logger.warn(
        `Transient meta publish failure for draft=${draftId}; BullMQ will retry: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }
}
