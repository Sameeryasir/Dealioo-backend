import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';
import { splitAutomationEmailBody } from '../../modules/automation/automation-email-merge.util';

export function PaymentReminderEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
  directBody,
}: AutomationEmailTemplateProps) {
  const body = message?.trim() ?? '';
  const paragraphs = body ? splitAutomationEmailBody(body) : [];
  const useDirectBody = directBody || Boolean(body);

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || subject?.trim() || ''}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
      skipTitle={useDirectBody}
      skipGreeting={useDirectBody}
    />
  );
}