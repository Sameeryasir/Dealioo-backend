import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';
import { splitAutomationEmailBody } from '../../modules/automation/automation-email-merge.util';

const DEFAULT_PAYMENT_CONFIRMATION_MESSAGE =
  'Thank you for trusting us. Your payment is confirmed. Tap the button below to view your QR code and show it at the business.';

export function PaymentConfirmationEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
  directBody,
}: AutomationEmailTemplateProps) {
  const body = message?.trim() || DEFAULT_PAYMENT_CONFIRMATION_MESSAGE;
  const paragraphs = splitAutomationEmailBody(body);
  const useDirectBody = directBody || Boolean(message?.trim());

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Your payment is confirmed'}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
      skipTitle={useDirectBody}
      skipGreeting={useDirectBody}
    />
  );
}
