import { Injectable, Logger } from '@nestjs/common';
import { BrevoService } from './brevo.service';
import type { BrevoSendResult } from './brevo-mail.types';

const DEFAULT_MAIL_SEND_MS = 20_000;

@Injectable()
export class MailDeliveryService {
  private readonly logger = new Logger(MailDeliveryService.name);

  constructor(private readonly brevo: BrevoService) {}

  async sendHtmlEmail(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    tags?: string[];
  }): Promise<BrevoSendResult> {
    this.logger.log(`Sending email to ${params.to}`);
    return this.withTimeout(
      this.brevo.sendAutomationEmail({
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        tags: params.tags,
      }),
      this.resolveSendTimeoutMs(),
      `Email send timed out after ${this.resolveSendTimeoutMs()}ms`,
    );
  }

  private resolveSendTimeoutMs(): number {
    const raw = process.env.MAIL_SEND_TIMEOUT_MS?.trim();
    if (!raw) {
      return DEFAULT_MAIL_SEND_MS;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_MAIL_SEND_MS;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
