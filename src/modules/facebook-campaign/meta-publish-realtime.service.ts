import { Injectable, Logger } from '@nestjs/common';
import {
  PUSHER_EVENT,
  pusherBusinessMetaPublishChannel,
} from '../pusher/pusher.constants';
import { PusherService } from '../pusher/pusher.service';

export type MetaPublishProgressPayload = {
  businessId: number;
  draftId: string;
  status: string;
  publishStatus: string | null;
  publishStep: string | null;
  publishProgress: number;
  jobId: string | null;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaCreativeId: string | null;
  metaAdId: string | null;
  errorMessage: string | null;
};

@Injectable()
export class MetaPublishRealtimeService {
  private readonly logger = new Logger(MetaPublishRealtimeService.name);

  constructor(private readonly pusherService: PusherService) {}

  async notifyProgress(payload: MetaPublishProgressPayload): Promise<void> {
    if (!this.pusherService.isEnabled()) {
      return;
    }

    try {
      await this.pusherService.triggerRaw(
        pusherBusinessMetaPublishChannel(payload.businessId),
        PUSHER_EVENT.META_PUBLISH_PROGRESS,
        payload,
      );
    } catch (err) {
      this.logger.warn(
        `Meta publish Pusher notify failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
