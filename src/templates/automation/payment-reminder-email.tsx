import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

export function PaymentReminderEmail({
  customerName,
  subject,
  message,
  ctaLabel,
  ctaUrl,
}: AutomationEmailTemplateProps) {
  const paragraphs = [
    message?.trim() ||
      'You signed up but have not completed your payment yet. Finish checkout to unlock your offer.',
    'If you already paid, you can ignore this email.',
  ];

  return (
    <AutomationEmailLayout
      preview={subject}
      title="Complete your payment"
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel ?? 'Complete payment'}
      ctaUrl={ctaUrl}
    />
  );
}
