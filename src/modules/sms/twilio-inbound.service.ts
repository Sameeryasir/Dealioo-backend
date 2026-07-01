import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { ChatMessageService } from '../chat/chat-message.service';
import { TwilioService } from './twilio.service';

const EMPTY_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

@Injectable()
export class TwilioInboundService {
  private readonly logger = new Logger(TwilioInboundService.name);

  constructor(
    private readonly twilioService: TwilioService,
    private readonly chatMessageService: ChatMessageService,
  ) {}

  async handleInbound(
    params: Record<string, string>,
    signature: string | undefined,
    req: Request,
  ): Promise<string> {
    const webhookUrl = resolveTwilioWebhookUrl(req);

    if (
      !this.twilioService.validateInboundWebhook(signature, webhookUrl, params)
    ) {
      this.logger.warn(
        `Twilio inbound signature invalid for URL: ${webhookUrl}`,
      );
      throw new ForbiddenException('Invalid Twilio webhook signature.');
    }

    const from = params.From?.trim();
    const body = params.Body?.trim();
    const messageSid = params.MessageSid?.trim();

    if (!from || !body || !messageSid) {
      this.logger.warn('Twilio inbound webhook missing From, Body, or MessageSid.');
      return EMPTY_TWIML;
    }

    const result = await this.chatMessageService.recordInboundSmsMessage({
      fromPhone: from,
      body,
      messageSid,
      toPhone: params.To?.trim() ?? null,
    });

    if (!result.saved) {
      this.logger.warn(
        `Twilio inbound SMS from ${from} was not stored (MessageSid ${messageSid}).`,
      );
    }

    return EMPTY_TWIML;
  }
}

function resolveTwilioWebhookUrl(req: Request): string {
  const configured = process.env.TWILIO_WEBHOOK_PUBLIC_URL?.trim();
  if (configured) {
    return configured;
  }

  const forwardedProto = req.headers['x-forwarded-proto']?.toString();
  const protocol = forwardedProto?.split(',')[0]?.trim() || req.protocol || 'http';
  const forwardedHost = req.headers['x-forwarded-host']?.toString();
  const host =
    forwardedHost?.split(',')[0]?.trim() || req.get('host')?.trim() || '';

  return `${protocol}://${host}${req.originalUrl}`;
}
