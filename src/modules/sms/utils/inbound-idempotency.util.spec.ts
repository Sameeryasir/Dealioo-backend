import { buildInboundIdempotencyKey } from './inbound-idempotency.util';
import { MessagingProvider } from '../types/inbound-messaging.types';

describe('buildInboundIdempotencyKey', () => {
  it('builds a provider-scoped idempotency key', () => {
    expect(
      buildInboundIdempotencyKey(MessagingProvider.TWILIO, 'SM123'),
    ).toBe('chat_message:inbound:twilio:SM123');
  });

  it('trims external message ids', () => {
    expect(
      buildInboundIdempotencyKey(MessagingProvider.WHATSAPP, '  WA456  '),
    ).toBe('chat_message:inbound:whatsapp:WA456');
  });
});
