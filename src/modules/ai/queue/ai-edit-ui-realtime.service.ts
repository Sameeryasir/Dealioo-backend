import { Injectable, Logger } from '@nestjs/common';
import type { AiResponseDto } from '../dto/ai-response.dto';
import {
  PUSHER_EVENT,
  pusherBusinessAiEditUiChannel,
} from '../../pusher/pusher.constants';
import { PusherService } from '../../pusher/pusher.service';

export type AiEditUiPusherPayload = {
  businessId: number;
  jobId: string;
  status: 'completed' | 'failed';
  result?: AiResponseDto;
  error?: string;
};

@Injectable()
export class AiEditUiRealtimeService {
  private readonly logger = new Logger(AiEditUiRealtimeService.name);

  constructor(private readonly pusherService: PusherService) {}

  async notifyResult(payload: AiEditUiPusherPayload): Promise<void> {
    if (!this.pusherService.isEnabled()) {
      return;
    }

    try {
      await this.pusherService.triggerRaw(
        pusherBusinessAiEditUiChannel(payload.businessId),
        PUSHER_EVENT.AI_EDIT_UI_RESULT,
        payload as unknown as Record<string, unknown>,
      );
    } catch (err) {
      this.logger.warn(
        `AI edit-ui Pusher notify failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
