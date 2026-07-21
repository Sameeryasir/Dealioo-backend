import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';
import { splitAutomationEmailBody } from '../../modules/automation/automation-email-merge.util';

const DEFAULT_PAYMENT_CONFIRMATION_MESSAGE =
  'Thank you for trusting us. Your payment is confirmed. Your offer is ready whenever you visit — show your pass at the business when you arrive.';

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

  const passUrl = ctaUrl?.trim() || undefined;
  const passLabel = passUrl
    ? ctaLabel?.trim() || 'View my pass'
    : undefined;

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Your payment is confirmed'}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={passLabel}
      ctaUrl={passUrl}
      skipTitle={useDirectBody}
      skipGreeting={useDirectBody}
    />
  );
}
