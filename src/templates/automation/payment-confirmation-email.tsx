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
        'Tap the button below to view your QR code and show it at the restaurant.',
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
