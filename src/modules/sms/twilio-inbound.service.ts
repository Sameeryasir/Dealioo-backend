import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { ConversationMessageChannel } from '../../db/entities/conversation-message.entity';
import { InboundMessageRecorderService } from '../chat/inbound-message-recorder.service';
import { EMPTY_TWIML_RESPONSE } from './constants/twilio-inbound.constants';
import {
  MessagingProvider,
  type MessagingCorrelationContext,
} from './types/inbound-messaging.types';
import { TwilioWebhookValidatorService } from './twilio-webhook-validator.service';
import { MessagingWebhookLogger } from './utils/messaging-webhook.logger';
import {
  parseTwilioInboundPayload,
  previewInboundBody,
} from './utils/twilio-inbound-payload.util';
import { resolveTwilioWebhookUrls } from './utils/twilio-webhook-url.util';

@Injectable()
export class TwilioInboundService {
  private readonly logger = new Logger(TwilioInboundService.name);
  private readonly webhookLogger = new MessagingWebhookLogger(this.logger);

  constructor(
    private readonly webhookValidator: TwilioWebhookValidatorService,
    private readonly inboundMessageRecorder: InboundMessageRecorderService,
  ) {}

  async handleInbound(
    params: Record<string, string>,
    signature: string | undefined,
    req: Request,
  ): Promise<string> {
    const correlationId = params.MessageSid?.trim() || randomUUID();
    const logContext: MessagingCorrelationContext = {
      correlationId,
      provider: MessagingProvider.TWILIO,
      channel: ConversationMessageChannel.SMS,
      externalMessageId: params.MessageSid?.trim(),
    };
    const webhookUrls = resolveTwilioWebhookUrls(req);

    this.webhookLogger.log(logContext, 'webhook.received', {
      from: params.From?.trim() ?? null,
      to: params.To?.trim() ?? null,
      messageSid: params.MessageSid?.trim() ?? null,
      bodyPreview: params.Body ? previewInboundBody(params.Body.trim()) : null,
      webhookUrls,
      hasSignature: Boolean(signature?.trim()),
    });

    const validation = this.webhookValidator.validateSignature(
      signature,
      webhookUrls,
      params,
    );
    if (!validation.valid) {
      this.webhookLogger.warn(logContext, 'webhook.signature_rejected', {
        triedUrls: webhookUrls,
      });
      throw new ForbiddenException('Invalid Twilio webhook signature.');
    }

    this.webhookLogger.log(logContext, 'webhook.signature_verified', {
      matchedUrl: validation.matchedUrl ?? null,
    });

    const payload = parseTwilioInboundPayload(params);
    if (!payload) {
      this.webhookLogger.warn(logContext, 'webhook.missing_fields', {
        hasFrom: Boolean(params.From?.trim()),
        hasBody: Boolean(params.Body?.trim()),
        hasMessageSid: Boolean(params.MessageSid?.trim()),
      });
      return EMPTY_TWIML_RESPONSE;
    }

    const result = await this.inboundMessageRecorder.recordInboundSms({
      correlationId,
      fromPhone: payload.from,
      toPhone: payload.to,
      body: payload.body,
      messageSid: payload.messageSid,
      smsStatus: payload.smsStatus,
      context: {
        provider: MessagingProvider.TWILIO,
        channel: ConversationMessageChannel.SMS,
      },
    });

    if (result.saved) {
      this.webhookLogger.log(logContext, 'webhook.processed', {
        duplicate: Boolean(result.duplicate),
        messageId: result.messageId ?? null,
        customerId: result.customerId ?? null,
        businessId: result.businessId ?? null,
      });
    } else {
      this.webhookLogger.warn(logContext, 'webhook.not_stored', {
        reason: result.skipReason ?? 'unknown',
        customerId: result.customerId ?? null,
        businessId: result.businessId ?? null,
      });
    }

    return EMPTY_TWIML_RESPONSE;
  }

  async handleStatusCallback(
    params: Record<string, string>,
    signature: string | undefined,
    req: Request,
  ): Promise<string> {
    const correlationId = params.MessageSid?.trim() || randomUUID();
    const logContext: MessagingCorrelationContext = {
      correlationId,
      provider: MessagingProvider.TWILIO,
      channel: ConversationMessageChannel.SMS,
      externalMessageId: params.MessageSid?.trim(),
    };
    const webhookUrls = resolveTwilioWebhookUrls(req);

    this.webhookLogger.log(logContext, 'status.received', {
      messageSid: params.MessageSid?.trim() ?? null,
      messageStatus: params.MessageStatus?.trim() ?? null,
      smsStatus: params.SmsStatus?.trim() ?? null,
      from: params.From?.trim() ?? null,
      to: params.To?.trim() ?? null,
      webhookUrls,
    });

    const validation = this.webhookValidator.validateSignature(
      signature,
      webhookUrls,
      params,
    );
    if (!validation.valid) {
      this.webhookLogger.warn(logContext, 'status.signature_rejected', {
        triedUrls: webhookUrls,
      });
      throw new ForbiddenException('Invalid Twilio webhook signature.');
    }

    this.webhookLogger.log(logContext, 'status.acknowledged', {
      matchedUrl: validation.matchedUrl ?? null,
      messageStatus: params.MessageStatus?.trim() ?? null,
    });

    return EMPTY_TWIML_RESPONSE;
  }
}
