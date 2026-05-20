import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

export function GenericAutomationEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
}: AutomationEmailTemplateProps) {
  const paragraphs = [
    message?.trim() || 'We have an update for you regarding your recent activity.',
  ];

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || subject}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
    />
  );
}
