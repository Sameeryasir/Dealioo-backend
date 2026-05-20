import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

export function AbandonedCheckoutReminderEmail({
  customerName,
  subject,
  message,
  ctaLabel,
  ctaUrl,
}: AutomationEmailTemplateProps) {
  const paragraphs = [
    message?.trim() ||
      'You left checkout before finishing your payment. Come back anytime to complete your order and enjoy exclusive offers.',
    'If you need help, reply to this email and our team will assist you.',
  ];

  return (
    <AutomationEmailLayout
      preview={subject}
      title="Complete your checkout"
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel ?? 'Return to checkout'}
      ctaUrl={ctaUrl}
    />
  );
}
