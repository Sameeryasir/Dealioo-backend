import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

const DEFAULT_QR_PASS_MESSAGE =
  'Your offer pass is ready! Tap the button below to view your QR code.\n\n' +
  'How to use your pass:\n' +
  '1. Open your pass and tap Add to Apple Wallet or Google Wallet\n' +
  '2. Visit the business and show your pass at the scanner when you pay\n\n' +
  'Prefer to pay online? You can still complete checkout anytime.';

export function QrPassGuideEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
}: AutomationEmailTemplateProps) {
  const body = message?.trim() || DEFAULT_QR_PASS_MESSAGE;
  const paragraphs = body.split(/\n\n+/).filter(Boolean);

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Your QR pass is ready'}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel ?? 'View my pass'}
      ctaUrl={ctaUrl}
    />
  );
}
