import {
  ConversationMessageChannel,
  ConversationMessageDirection,
} from '../../db/entities/conversation-message.entity';

export type RecordOutboundMessageDto = {
  restaurantId: number;
  customerId: number;
  automationId?: number | null;
  executionId?: number | null;
  nodeId?: number | null;
  channel: ConversationMessageChannel;
  direction?: ConversationMessageDirection;
  bodyPreview: string;
  idempotencyKey: string;
  sentAt?: Date;
  metadata?: Record<string, unknown> | null;
};
