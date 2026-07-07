import type { MessagingCorrelationContext } from '../types/inbound-messaging.types';

export type RecordInboundSmsDto = {
  correlationId: string;
  fromPhone: string;
  toPhone?: string | null;
  body: string;
  messageSid: string;
  smsStatus?: string | null;
  context?: Pick<MessagingCorrelationContext, 'provider' | 'channel'>;
};
