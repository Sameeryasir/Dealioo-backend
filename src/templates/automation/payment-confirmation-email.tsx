import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

export function PaymentConfirmationEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
}: AutomationEmailTemplateProps) {
  const paragraphs = message?.trim()
    ? [message.trim()]
    : [
        'Thank you for trusting us. Your payment is confirmed.',
        'We are glad to have you with us and will send any receipts or updates to this email.',
      ];

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Your payment is confirmed'}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
    />
  );
}
