import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Brevo, BrevoClient, BrevoError } from '@getbrevo/brevo';
import { BrevoSendFailedError } from './brevo-mail.errors';
import type {
  BrevoAutomationEmailPayload,
  BrevoBulkSendOptions,
  BrevoBulkSendResult,
  BrevoSendResult,
  BrevoTransactionalContent,
} from './brevo-mail.types';

const BREVO_MAX_RECIPIENTS_PER_REQUEST = 2000;

const REQUIRED_ENV_KEYS = [
  'BREVO_API_KEY',
  'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME',
] as const;

@Injectable()
export class BrevoService implements OnModuleInit {
  private readonly logger = new Logger(BrevoService.name);
  private client: BrevoClient | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const missing = REQUIRED_ENV_KEYS.filter(
      (key) => !this.config.get<string>(key)?.trim(),
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing required Brevo env: ${missing.join(', ')}. Set them in .env before starting the app.`,
      );
    }

    const apiKey = this.config.getOrThrow<string>('BREVO_API_KEY').trim();
    if (apiKey.toLowerCase().startsWith('xsmtpsib-')) {
      throw new Error(
        'BREVO_API_KEY is an SMTP key (xsmtpsib-). Use a REST API key (xkeysib-) from Brevo → SMTP & API → API keys.',
      );
    }

    this.logger.log(
      `Brevo email ready (sender: ${this.getSender().email}, baseUrl: ${this.getBaseUrl()})`,
    );
  }

  getWelcomeTemplateId(): number | undefined {
    return this.parseOptionalTemplateId('BREVO_WELCOME_TEMPLATE_ID');
  }

  getPaymentConfirmationTemplateId(): number | undefined {
    return this.parseOptionalTemplateId('BREVO_PAYMENT_CONFIRMATION_TEMPLATE_ID');
  }

  getAbandonedPaymentTemplateId(): number | undefined {
    return this.parseOptionalTemplateId('BREVO_ABANDONED_PAYMENT_TEMPLATE_ID');
  }

  async sendAutomationEmail(
    payload: BrevoAutomationEmailPayload,
  ): Promise<BrevoSendResult> {
    const to = payload.to?.trim();
    if (!to) {
      throw new BrevoSendFailedError(
        'Brevo email request is invalid. Check sender, recipient, templateId, or params.',
        400,
      );
    }

    const templateId = payload.templateId;
    const hasTemplate = templateId !== undefined && templateId > 0;

    if (hasTemplate) {
      return this.dispatch({
        sender: this.getSender(),
        to: [{ email: to, name: payload.toName?.trim() || undefined }],
        templateId,
        params: payload.params,
        tags: payload.tags,
      });
    }

    const subject = payload.subject?.trim();
    const html = payload.html?.trim();
    if (!subject || !html) {
      throw new BrevoSendFailedError(
        'Brevo email request is invalid. Check sender, recipient, templateId, or params.',
        400,
      );
    }

    const text =
      payload.text?.trim() ??
      html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    return this.dispatch({
      sender: this.getSender(),
      to: [{ email: to, name: payload.toName?.trim() || undefined }],
      subject,
      htmlContent: html,
      textContent: text,
      tags: payload.tags,
    });
  }

  async sendWelcomeEmail(
    customerEmail: string,
    customerName: string,
    content: BrevoTransactionalContent,
    extraParams?: Record<string, unknown>,
  ): Promise<BrevoSendResult> {
    const templateId = this.getWelcomeTemplateId();
    return this.sendAutomationEmail({
      to: customerEmail,
      toName: customerName,
      templateId,
      params: {
        customerName,
        ...extraParams,
      },
      subject: content.subject,
      html: content.html,
      text: content.text,
      tags: ['automation', 'welcome'],
    });
  }

  async sendPaymentConfirmationEmail(
    customerEmail: string,
    customerName: string,
    amount: string | number | undefined,
    content: BrevoTransactionalContent,
    extraParams?: Record<string, unknown>,
  ): Promise<BrevoSendResult> {
    const templateId = this.getPaymentConfirmationTemplateId();
    return this.sendAutomationEmail({
      to: customerEmail,
      toName: customerName,
      templateId,
      params: {
        customerName,
        amount: amount ?? '',
        ...extraParams,
      },
      subject: content.subject,
      html: content.html,
      text: content.text,
      tags: ['automation', 'payment_confirmation'],
    });
  }

  async sendAbandonedPaymentReminderEmail(
    customerEmail: string,
    customerName: string,
    content: BrevoTransactionalContent,
    extraParams?: Record<string, unknown>,
  ): Promise<BrevoSendResult> {
    const bulk = await this.sendPaymentReminderBulk({
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
    });
    return { messageId: bulk.messageIds[0] };
  }

  async sendPaymentReminderBulk(
    options: BrevoBulkSendOptions,
  ): Promise<BrevoBulkSendResult> {
    const templateId =
      options.templateId ?? this.getAbandonedPaymentTemplateId();
    return this.sendBulkTransactionalEmail({
      ...options,
      templateId,
      tags: options.tags ?? ['automation', 'payment_reminder'],
    });
  }

  async sendBulkTransactionalEmail(
    options: BrevoBulkSendOptions,
  ): Promise<BrevoBulkSendResult> {
    const recipients = options.recipients
      .map((recipient) => ({
        ...recipient,
        email: recipient.email?.trim(),
      }))
      .filter((recipient): recipient is typeof recipient & { email: string } =>
        Boolean(recipient.email),
      );

    if (recipients.length === 0) {
      throw new BrevoSendFailedError(
        'Brevo email request is invalid. Check sender, recipient, templateId, or params.',
        400,
      );
    }

    const subject = options.subject?.trim();
    const templateId = options.templateId;
    const hasTemplate = templateId !== undefined && templateId > 0;

    if (!hasTemplate && !subject) {
      throw new BrevoSendFailedError(
        'Brevo email request is invalid. Check sender, recipient, templateId, or params.',
        400,
      );
    }

    const messageIds: string[] = [];
    const chunks = this.chunkRecipients(
      recipients,
      BREVO_MAX_RECIPIENTS_PER_REQUEST,
    );

    for (const chunk of chunks) {
      const request = this.buildBulkSendRequest(chunk, {
        subject: subject ?? '',
        templateId: hasTemplate ? templateId : undefined,
        tags: options.tags,
      });
      const result = await this.dispatchBulk(request, chunk.length);
      if (result.messageIds?.length) {
        messageIds.push(...result.messageIds);
      } else if (result.messageId) {
        messageIds.push(result.messageId);
      }
    }

    return {
      messageIds,
      recipientCount: recipients.length,
      requestCount: chunks.length,
    };
  }

  private buildBulkSendRequest(
    recipients: BrevoBulkSendOptions['recipients'],
    options: {
      subject: string;
      templateId?: number;
      tags?: string[];
    },
  ): Brevo.SendTransacEmailRequest {
    const sender = this.getSender();
    const base = {
      sender,
      tags: options.tags,
    };

    if (options.templateId) {
      return {
        ...base,
        templateId: options.templateId,
        subject: options.subject,
        messageVersions: this.buildTemplateMessageVersions(
          recipients,
          options.subject,
        ),
      };
    }

    const sharedHtml = recipients[0]?.html?.trim();
    const allShareSameBody =
      Boolean(sharedHtml) &&
      recipients.every((recipient) => recipient.html?.trim() === sharedHtml);

    if (allShareSameBody && sharedHtml) {
      const sharedText =
        recipients[0]?.text?.trim() ??
        sharedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      return {
        ...base,
        subject: options.subject,
        htmlContent: sharedHtml,
        textContent: sharedText,
        to: recipients.map((recipient) => ({
          email: recipient.email,
          name: recipient.name?.trim() || undefined,
        })),
      };
    }

    return {
      ...base,
      messageVersions: this.buildHtmlMessageVersions(recipients, options.subject),
    };
  }

  private buildTemplateMessageVersions(
    recipients: BrevoBulkSendOptions['recipients'],
    subject: string,
  ): Brevo.SendTransacEmailRequest.MessageVersions.Item[] {
    return recipients.map((recipient) => ({
      to: [
        {
          email: recipient.email,
          name: recipient.name?.trim() || undefined,
        },
      ],
      subject,
      params: {
        customerName: recipient.name ?? '',
        ...recipient.params,
      },
    }));
  }

  private buildHtmlMessageVersions(
    recipients: BrevoBulkSendOptions['recipients'],
    subject: string,
  ): Brevo.SendTransacEmailRequest.MessageVersions.Item[] {
    return recipients.map((recipient) => {
      const html = recipient.html?.trim() ?? '';
      const text =
        recipient.text?.trim() ??
        html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      return {
        to: [
          {
            email: recipient.email,
            name: recipient.name?.trim() || undefined,
          },
        ],
        subject,
        htmlContent: html,
        textContent: text,
      };
    });
  }

  private chunkRecipients<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += chunkSize) {
      chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
  }

  private async dispatchBulk(
    request: Brevo.SendTransacEmailRequest,
    recipientCount: number,
  ): Promise<BrevoSendResult & { messageIds?: string[] }> {
    this.logger.log(
      `Sending Brevo bulk email to ${recipientCount} recipient(s) in one API request`,
    );

    try {
      const response =
        await this.getClient().transactionalEmails.sendTransacEmail(request);
      const messageId = this.extractMessageId(response);
      const messageIds = this.extractMessageIds(response);

      if (messageId) {
        this.logger.log(
          `Brevo bulk email accepted for ${recipientCount} recipient(s) (messageId: ${messageId})`,
        );
      } else {
        this.logger.log(
          `Brevo bulk email accepted for ${recipientCount} recipient(s)`,
        );
      }

      return { messageId, messageIds };
    } catch (error) {
      this.logBrevoFailure(error, `${recipientCount} recipients`);
      throw this.toSendFailedError(error);
    }
  }

  private extractMessageIds(data: unknown): string[] | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }
    const record = data as Brevo.SendTransacEmailResponse;
    if (Array.isArray(record.messageIds) && record.messageIds.length > 0) {
      return record.messageIds.filter(
        (id): id is string => typeof id === 'string' && id.trim().length > 0,
      );
    }
    return undefined;
  }

  private async dispatch(
    request: Brevo.SendTransacEmailRequest,
  ): Promise<BrevoSendResult> {
    const recipient = request.to?.[0]?.email ?? 'unknown';
    this.logger.log(`Sending Brevo email to ${recipient}`);

    try {
      const response =
        await this.getClient().transactionalEmails.sendTransacEmail(request);
      const messageId = this.extractMessageId(response);

      if (messageId) {
        this.logger.log(
          `Brevo email sent to ${recipient} (messageId: ${messageId})`,
        );
      } else {
        this.logger.log(`Brevo email sent to ${recipient}`);
      }

      return { messageId };
    } catch (error) {
      this.logBrevoFailure(error, recipient);
      throw this.toSendFailedError(error);
    }
  }

  private getClient(): BrevoClient {
    if (!this.client) {
      this.client = new BrevoClient({
        apiKey: this.config.getOrThrow<string>('BREVO_API_KEY').trim(),
        baseUrl: this.getBaseUrl(),
        timeoutInSeconds: 30,
        maxRetries: 2,
      });
    }
    return this.client;
  }

  private getBaseUrl(): string {
    return (
      this.config.get<string>('BREVO_BASE_URL')?.trim() ||
      'https://api.brevo.com/v3'
    );
  }

  private getSender(): { name: string; email: string } {
    return {
      name: this.config.getOrThrow<string>('BREVO_SENDER_NAME').trim(),
      email: this.config.getOrThrow<string>('BREVO_SENDER_EMAIL').trim(),
    };
  }

  private parseOptionalTemplateId(envKey: string): number | undefined {
    const raw = this.config.get<string>(envKey)?.trim();
    if (!raw) {
      return undefined;
    }
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : undefined;
  }

  private extractMessageId(data: unknown): string | undefined {
    if (!data || typeof data !== 'object') {
      return undefined;
    }
    const record = data as Brevo.SendTransacEmailResponse;
    const id = record.messageId ?? record.messageIds?.[0];
    return typeof id === 'string' && id.trim() ? id.trim() : undefined;
  }

  private logBrevoFailure(error: unknown, recipient: string): void {
    if (error instanceof BrevoError) {
      const bodyMessage = this.extractBrevoBodyMessage(error.body);
      this.logger.error(
        `Brevo send failed for ${recipient} (status ${error.statusCode ?? 'unknown'}): ${bodyMessage ?? error.message}`,
      );
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Brevo send failed for ${recipient}: ${message}`);
  }

  private extractBrevoBodyMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') {
      return undefined;
    }
    const record = body as Record<string, unknown>;
    const message = record.message;
    return typeof message === 'string' && message.trim()
      ? message.trim()
      : undefined;
  }

  private toSendFailedError(error: unknown): BrevoSendFailedError {
    if (error instanceof BrevoSendFailedError) {
      return error;
    }

    if (error instanceof BrevoError) {
      const status = error.statusCode;
      if (status === 401) {
        return new BrevoSendFailedError(
          'Brevo authentication failed. Check API key or authorised IP settings.',
          401,
        );
      }
      if (status === 400) {
        return new BrevoSendFailedError(
          'Brevo email request is invalid. Check sender, recipient, templateId, or params.',
          400,
        );
      }
      return new BrevoSendFailedError(
        'Failed to send email via Brevo. Please try again later.',
        status,
      );
    }

    return new BrevoSendFailedError(
      'Failed to send email via Brevo. Please try again later.',
    );
  }
}
