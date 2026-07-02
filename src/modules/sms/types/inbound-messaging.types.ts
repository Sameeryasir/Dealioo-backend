import type { ConversationMessageChannel } from '../../../db/entities/conversation-message.entity';

export enum MessagingProvider {
  TWILIO = 'twilio',
  WHATSAPP = 'whatsapp',
}

export enum InboundMessageSkipReason {
  MISSING_FIELDS = 'missing_message_sid_body_or_from',
  CUSTOMER_NOT_FOUND = 'customer_not_found',
  CONVERSATION_NOT_FOUND = 'conversation_not_found',
  PERSIST_FAILED = 'persist_failed',
  DATABASE_ERROR = 'database_error',
}

export type InboundMessageRecordResult = {
  saved: boolean;
  duplicate?: boolean;
  messageId?: number;
  customerId?: number;
  restaurantId?: number;
  skipReason?: InboundMessageSkipReason;
};

export type MessagingCorrelationContext = {
  correlationId: string;
  provider: MessagingProvider;
  channel: ConversationMessageChannel;
  externalMessageId?: string;
};

export type TwilioInboundPayload = {
  from: string;
  to: string | null;
  body: string;
  messageSid: string;
  smsStatus?: string | null;
  rawParams: Record<string, string>;
};
