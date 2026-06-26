import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';
import { splitAutomationEmailBody } from '../../modules/automation/automation-email-merge.util';

const DEFAULT_PAYMENT_REMINDER_MESSAGE =
  'Hi — thank you for signing up! Your offer is almost ready. Please complete your payment to unlock it. If you already paid, you can ignore this email.';

export function PaymentReminderEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
}: AutomationEmailTemplateProps) {
  const body = message?.trim() || DEFAULT_PAYMENT_REMINDER_MESSAGE;
  const paragraphs = splitAutomationEmailBody(body);

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Complete your payment'}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel ?? 'Complete payment'}
      ctaUrl={ctaUrl}
      skipTitle
      skipGreeting
    />
  );
}