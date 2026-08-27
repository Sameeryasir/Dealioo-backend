import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';
import type { AutomationEmailTemplateProps } from './types';

const DEFAULT_QR_PASS_MESSAGE =
  'Your offer pass is ready! Tap the button below to view your QR code.\n\n' +
  'How to use your pass:\n\n' +
  '1. Open your pass and tap Add to Apple Wallet or Google Wallet\n' +
  '2. Visit the business and show your pass at the scanner when you pay\n\n' +
  'Prefer to pay online? You can still complete checkout anytime.';

function formatQrPassParagraphs(body: string): string[] {
  const normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/\s+How to use your pass:\s*/i, '\n\nHow to use your pass:\n\n')
    .replace(/\s+(1\.\s+)/g, '\n$1')
    .replace(/\s+(2\.\s+)/g, '\n$1')
    .replace(/\s+Prefer to pay online\?/gi, '\n\nPrefer to pay online?');

  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function QrPassGuideEmail({
  customerName,
  subject,
  headline,
  message,
  ctaLabel,
  ctaUrl,
  qrImageDataUrl,
  googleWalletSaveUrl,
}: AutomationEmailTemplateProps) {
  const body = message?.trim() || DEFAULT_QR_PASS_MESSAGE;
  const paragraphs = formatQrPassParagraphs(body);

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline?.trim() || 'Your QR pass is ready'}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel={ctaLabel ?? 'View my pass'}
      ctaUrl={ctaUrl}
      qrImageDataUrl={qrImageDataUrl}
      googleWalletSaveUrl={googleWalletSaveUrl}
    />
  );
}
