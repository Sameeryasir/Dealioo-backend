import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

export function SignupWelcomeEmail({
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
        'Thank you for signing up! Your registration was successful.',
        'We are excited to have you with us and will keep you updated on what happens next.',
        'If you have any questions, just reply to this email.',
      ];

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Thanks for signing up!'}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
    />
  );
}
