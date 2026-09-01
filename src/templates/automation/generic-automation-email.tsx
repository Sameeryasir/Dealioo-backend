import * as React from 'react';
import { splitAutomationEmailBody } from '../../modules/automation/automation-email-merge.util';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

export function GenericAutomationEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
  qrImageDataUrl,
  googleWalletSaveUrl,
}: AutomationEmailTemplateProps) {
  const body = message?.trim() ?? '';
  const paragraphs = body ? splitAutomationEmailBody(body) : [];

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || subject}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
      qrImageDataUrl={qrImageDataUrl}
      googleWalletSaveUrl={googleWalletSaveUrl}
    />
  );
}
