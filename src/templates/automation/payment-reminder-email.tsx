import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

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
  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Complete your payment'}
      customerName={customerName}
      paragraphs={[message?.trim() || DEFAULT_PAYMENT_REMINDER_MESSAGE]}
      ctaLabel={ctaLabel ?? 'Complete payment'}
      ctaUrl={ctaUrl}
    />
  );
}
