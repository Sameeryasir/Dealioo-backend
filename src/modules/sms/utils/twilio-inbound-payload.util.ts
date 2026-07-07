import { INBOUND_BODY_LOG_MAX_LENGTH } from '../constants/twilio-inbound.constants';
import type { TwilioInboundPayload } from '../types/inbound-messaging.types';

export function parseTwilioInboundPayload(
  params: Record<string, string>,
): TwilioInboundPayload | null {
  const from = params.From?.trim();
  const body = params.Body?.trim();
  const messageSid = params.MessageSid?.trim();

  if (!from || !body || !messageSid) {
    return null;
  }

  return {
    from,
    to: params.To?.trim() ?? null,
    body,
    messageSid,
    smsStatus: params.SmsStatus?.trim() ?? null,
    rawParams: params,
  };
}

export function previewInboundBody(body: string): string {
  if (body.length <= INBOUND_BODY_LOG_MAX_LENGTH) {
    return body;
  }

  return `${body.slice(0, INBOUND_BODY_LOG_MAX_LENGTH)}…`;
}
