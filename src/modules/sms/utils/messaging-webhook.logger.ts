import { Logger } from '@nestjs/common';
import type { MessagingCorrelationContext } from '../types/inbound-messaging.types';

type LogPayload = Record<string, unknown>;

export class MessagingWebhookLogger {
  constructor(private readonly logger: Logger) {}

  log(
    context: MessagingCorrelationContext,
    event: string,
    payload: LogPayload = {},
  ): void {
    this.logger.log(this.format(context, event, payload));
  }

  warn(
    context: MessagingCorrelationContext,
    event: string,
    payload: LogPayload = {},
  ): void {
    this.logger.warn(this.format(context, event, payload));
  }

  error(
    context: MessagingCorrelationContext,
    event: string,
    payload: LogPayload = {},
  ): void {
    this.logger.error(this.format(context, event, payload));
  }

  private format(
    context: MessagingCorrelationContext,
    event: string,
    payload: LogPayload,
  ): string {
    return JSON.stringify({
      scope: 'inbound_messaging',
      event,
      correlationId: context.correlationId,
      provider: context.provider,
      channel: context.channel,
      externalMessageId: context.externalMessageId ?? null,
      ...payload,
    });
  }
}
