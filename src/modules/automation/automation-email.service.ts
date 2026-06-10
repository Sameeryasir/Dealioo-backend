import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import type { AutomationEmailTemplateProps } from '../../templates/automation/types';
import { BrevoService } from '../mail/brevo.service';
import {
  customerDisplayName,
  getBrevoTemplateIdForPurpose,
  getPurposeEmailDefaults,
  getTagsForPurpose,
  parseEmailNodeConfig,
  resolveEmailTemplateKey,
  resolveSubjectForPurpose,
} from './automation-email-catalog';
import { truncateActivityMessagePreview } from '../../utils/truncate-activity-message';
import { AutomationEmailRendererService } from './automation-email-renderer.service';
import type {
  AutomationEmailSendResult,
  EmailRecipient,
  PreparedAutomationEmail,
  RenderedRecipientEmail,
} from './automation-email.types';

const DEFAULT_MAIL_SEND_MS = 20_000;

@Injectable()
export class AutomationEmailService {
  private readonly logger = new Logger(AutomationEmailService.name);

  constructor(
    private readonly brevo: BrevoService,
    private readonly config: ConfigService,
    private readonly emailRenderer: AutomationEmailRendererService,
  ) {}

  prepareFromEmailNode(
    emailNodeConfig: Record<string, unknown>,
    purpose: AutomationPurpose,
    options?: { requireSubject?: boolean; campaignName?: string },
  ): PreparedAutomationEmail {
    const parsed = parseEmailNodeConfig(emailNodeConfig);
    const campaignName = options?.campaignName?.trim() || 'the campaign';
    const subject = resolveSubjectForPurpose(
      purpose,
      parsed.subject,
      campaignName,
      parsed.rawTemplate,
    );

    if (options?.requireSubject && !subject) {
      throw new BadRequestException(
        'Email node config must include subject.',
      );
    }

    const templateKey = resolveEmailTemplateKey(purpose, parsed.rawTemplate);
    const defaults = getPurposeEmailDefaults(purpose, campaignName);
    const templateProps: Partial<AutomationEmailTemplateProps> = {};

    if (parsed.message) {
      templateProps.message = parsed.message;
    } else if (defaults.message) {
      templateProps.message = defaults.message;
    }
    if (parsed.headline) {
      templateProps.headline = parsed.headline;
    } else if (defaults.headline) {
      templateProps.headline = defaults.headline;
    }
    if (parsed.ctaLabel) {
      templateProps.ctaLabel = parsed.ctaLabel;
    }
    if (parsed.ctaUrl) {
      templateProps.ctaUrl = parsed.ctaUrl;
    }

    return { subject, templateKey, templateProps };
  }

  /** Headline or short message for the restaurant activity feed. */
  resolvePreparedEmailPreview(prepared: PreparedAutomationEmail): string {
    const headline = prepared.templateProps.headline?.trim();
    if (headline) {
      return truncateActivityMessagePreview(headline);
    }

    const message = prepared.templateProps.message?.trim();
    if (message) {
      return truncateActivityMessagePreview(message);
    }

    return truncateActivityMessagePreview(prepared.subject);
  }

  buildTemplatePropsForRecipient(
    prepared: PreparedAutomationEmail,
    recipient: EmailRecipient,
    subject: string,
  ): AutomationEmailTemplateProps {
    const customerName = customerDisplayName(recipient.name, recipient.email);
    return {
      customerName,
      customerEmail: recipient.email,
      subject,
      ...prepared.templateProps,
    };
  }

  async renderForRecipient(
    prepared: PreparedAutomationEmail,
    recipient: EmailRecipient,
    subject: string,
  ) {
    const props = this.buildTemplatePropsForRecipient(
      prepared,
      recipient,
      subject,
    );
    return this.emailRenderer.render(prepared.templateKey, props);
  }

  async renderRecipients(
    prepared: PreparedAutomationEmail,
    recipients: EmailRecipient[],
    subject: string,
  ): Promise<RenderedRecipientEmail[]> {
    return Promise.all(
      recipients.map(async (recipient) => {
        const { html, text } = await this.renderForRecipient(
          prepared,
          recipient,
          subject,
        );
        return {
          ...recipient,
          html,
          text,
        };
      }),
    );
  }

  async deliverRendered(
    purpose: AutomationPurpose,
    rendered: RenderedRecipientEmail[],
    subject: string,
    extraTags: string[] = [],
  ): Promise<AutomationEmailSendResult> {
    if (rendered.length === 0) {
      return {
        sent: false,
        error: 'No recipients to send to',
        recipientCount: 0,
        messageIds: [],
      };
    }

    const tags = [...getTagsForPurpose(purpose), ...extraTags];
    const templateId = getBrevoTemplateIdForPurpose(
      purpose,
      this.getBrevoTemplateEnv(),
    );

    try {
      if (templateId) {
        const bulk = await this.withTimeout(
          this.brevo.sendBulkTransactionalEmail({
            recipients: rendered.map((recipient) => ({
              email: recipient.email,
              name: customerDisplayName(recipient.name, recipient.email),
              params: {
                customerName: customerDisplayName(
                  recipient.name,
                  recipient.email,
                ),
                subject,
              },
            })),
            subject,
            templateId,
            tags,
          }),
          this.resolveBulkSendTimeoutMs(rendered.length),
          'Email send timed out',
        );
        return {
          sent: true,
          error: null,
          recipientCount: rendered.length,
          messageIds: bulk.messageIds,
        };
      }

      const bulk = await this.withTimeout(
        this.brevo.sendBulkTransactionalEmail({
          recipients: rendered.map((recipient) => ({
            email: recipient.email,
            name: customerDisplayName(recipient.name, recipient.email),
            html: recipient.html,
            text: recipient.text,
            params: {
              customerName: customerDisplayName(
                recipient.name,
                recipient.email,
              ),
              subject,
            },
          })),
          subject,
          tags,
        }),
        this.resolveBulkSendTimeoutMs(rendered.length),
        'Email send timed out',
      );

      return {
        sent: true,
        error: null,
        recipientCount: rendered.length,
        messageIds: bulk.messageIds,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Email send failed';
      this.logger.error(
        `Email delivery failed (${purpose}, ${rendered.length} recipient(s)): ${message}`,
      );
      return {
        sent: false,
        error: message,
        recipientCount: 0,
        messageIds: [],
      };
    }
  }

  async sendBulkToRecipients(
    purpose: AutomationPurpose,
    recipients: EmailRecipient[],
    prepared: PreparedAutomationEmail,
    extraTags: string[] = [],
  ): Promise<AutomationEmailSendResult> {
    const rendered = await this.renderRecipients(
      prepared,
      recipients,
      prepared.subject,
    );
    return this.deliverRendered(
      purpose,
      rendered,
      prepared.subject,
      extraTags,
    );
  }

  async sendToCustomer(
    purpose: AutomationPurpose,
    recipient: EmailRecipient,
    emailNodeConfig: Record<string, unknown>,
    campaignName: string,
    extraTags: string[] = [],
  ): Promise<AutomationEmailSendResult> {
    const prepared = this.prepareFromEmailNode(emailNodeConfig, purpose, {
      campaignName,
    });
    const to = recipient.email?.trim();

    if (!to) {
      return {
        sent: false,
        error: 'Missing customer email',
        recipientCount: 0,
        messageIds: [],
      };
    }

    if (!prepared.subject) {
      return {
        sent: false,
        error: 'Missing subject',
        recipientCount: 0,
        messageIds: [],
      };
    }

    const rendered = await this.renderRecipients(
      prepared,
      [recipient],
      prepared.subject,
    );
    return this.deliverRendered(
      purpose,
      rendered,
      prepared.subject,
      extraTags,
    );
  }

  private getBrevoTemplateEnv(): {
    welcome?: string;
    paymentConfirmation?: string;
    abandonedPayment?: string;
  } {
    return {
      welcome: this.config.get<string>('BREVO_WELCOME_TEMPLATE_ID'),
      paymentConfirmation: this.config.get<string>(
        'BREVO_PAYMENT_CONFIRMATION_TEMPLATE_ID',
      ),
      abandonedPayment: this.config.get<string>(
        'BREVO_ABANDONED_PAYMENT_TEMPLATE_ID',
      ),
    };
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
    return Math.min(base + recipientCount * 2_000, 120_000);
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
