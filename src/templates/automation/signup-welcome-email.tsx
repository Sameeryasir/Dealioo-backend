import * as React from 'react';
import { splitAutomationEmailBody } from '../../modules/automation/automation-email-merge.util';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

export function SignupWelcomeEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
  directBody,
  qrImageDataUrl,
  googleWalletSaveUrl,
}: AutomationEmailTemplateProps) {
  const body = message?.trim() ?? '';
  const paragraphs = body
    ? splitAutomationEmailBody(body)
    : [];
  const useDirectBody = directBody || Boolean(body);

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Thanks for signing up!'}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel}
      ctaUrl={ctaUrl}
      qrImageDataUrl={qrImageDataUrl}
      googleWalletSaveUrl={googleWalletSaveUrl}
      skipTitle={useDirectBody}
      skipGreeting={useDirectBody}
    />
  );
}
