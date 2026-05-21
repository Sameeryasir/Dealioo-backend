import type { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import type { AutomationEmailTemplateProps } from '../../templates/automation/types';

export type ParsedEmailNodeConfig = {
  subject: string;
  message?: string;
  headline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  rawTemplate: string;
};

export type PreparedAutomationEmail = {
  subject: string;
  templateKey: string;
  templateProps: Partial<AutomationEmailTemplateProps>;
};

export type EmailRecipient = {
  customerId: number;
  email: string;
  name: string;
};

export type RenderedRecipientEmail = EmailRecipient & {
  html: string;
  text: string;
};

export type AutomationEmailSendResult = {
  sent: boolean;
  error: string | null;
  recipientCount: number;
  messageIds: string[];
};
