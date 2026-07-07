import { MessagingProvider } from '../types/inbound-messaging.types';

export function buildInboundIdempotencyKey(
  provider: MessagingProvider,
  externalMessageId: string,
): string {
  return `chat_message:inbound:${provider}:${externalMessageId.trim()}`;
}
