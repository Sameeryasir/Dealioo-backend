import { Injectable, Logger } from '@nestjs/common';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { BrevoService } from '../mail/brevo.service';
import type {
  BrevoAutomationEmailPayload,
  BrevoBulkSendOptions,
  BrevoBulkSendResult,
  BrevoSendResult,
  BrevoTransactionalContent,
} from '../mail/brevo-mail.types';

const DEFAULT_MAIL_SEND_MS = 20_000;

@Injectable()
export class AutomationMailService {
  private readonly logger = new Logger(AutomationMailService.name);

  constructor(private readonly brevo: BrevoService) {}

  async send(payload: BrevoAutomationEmailPayload): Promise<BrevoSendResult> {
    const timeoutMs = this.resolveSendTimeoutMs();
    return this.withTimeout(
      this.brevo.sendAutomationEmail(payload),
      timeoutMs,
      `Email send timed out after ${timeoutMs}ms`,
    );
  }

  async sendWelcomeEmail(
    customerEmail: string,
    customerName: string,
    content: BrevoTransactionalContent,
    extraParams?: Record<string, unknown>,
  ): Promise<BrevoSendResult> {
    return this.withTimeout(
      this.brevo.sendWelcomeEmail(
        customerEmail,
        customerName,
        content,
        extraParams,
      ),
      this.resolveSendTimeoutMs(),
      'Welcome email send timed out',
    );
  }

  async sendPaymentConfirmationEmail(
    customerEmail: string,
    customerName: string,
    amount: string | number | undefined,
    content: BrevoTransactionalContent,
    extraParams?: Record<string, unknown>,
  ): Promise<BrevoSendResult> {
    return this.withTimeout(
      this.brevo.sendPaymentConfirmationEmail(
        customerEmail,
        customerName,
        amount,
        content,
        extraParams,
      ),
      this.resolveSendTimeoutMs(),
      'Payment confirmation email send timed out',
    );
  }

  async sendAbandonedPaymentReminderEmail(
    customerEmail: string,
    customerName: string,
    content: BrevoTransactionalContent,
    extraParams?: Record<string, unknown>,
  ): Promise<BrevoSendResult> {
    return this.sendPaymentReminderBulk({
      recipients: [
        {
          email: customerEmail,
          name: customerName,
          html: content.html,
          text: content.text,
          params: { customerName, ...extraParams },
        },
      ],
      subject: content.subject,
    }).then((result) => ({ messageId: result.messageIds[0] }));
  }

  async sendPaymentReminderBulk(
    options: BrevoBulkSendOptions,
  ): Promise<BrevoBulkSendResult> {
    const recipientCount = options.recipients.length;
    const timeoutMs = this.resolveBulkSendTimeoutMs(recipientCount);
    const templateId =
      options.templateId ??
      this.brevo.getAbandonedPaymentTemplateId();

    return this.withTimeout(
      this.brevo.sendPaymentReminderBulk({
        ...options,
        templateId,
      }),
      timeoutMs,
      `Bulk payment reminder send timed out after ${timeoutMs}ms`,
    );
  }

  resolveTemplateIdForPurpose(
    purpose: AutomationPurpose,
  ): number | undefined {
    switch (purpose) {
      case AutomationPurpose.FUNNEL_SIGNUP:
        return this.brevo.getWelcomeTemplateId();
      case AutomationPurpose.FUNNEL_PAYMENT:
        return this.brevo.getPaymentConfirmationTemplateId();
      case AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER:
      case AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER:
        return this.brevo.getAbandonedPaymentTemplateId();
      default:
        return undefined;
    }
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

  private resolveBulkSendTimeoutMs(recipientCount: number): number {
    const base = this.resolveSendTimeoutMs();
    const scaled = base + recipientCount * 2_000;
    return Math.min(scaled, 120_000);
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
