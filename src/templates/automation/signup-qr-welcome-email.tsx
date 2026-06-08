import * as React from 'react';
import { AutomationEmailLayout } from './components/email-layout';

export type SignupQrWelcomeEmailProps = {
  customerName: string;
  subject: string;
  headline: string;
  campaignName: string;
  passUrl: string;
};

export function SignupQrWelcomeEmail({
  customerName,
  subject,
  headline,
  campaignName,
  passUrl,
}: SignupQrWelcomeEmailProps) {
  const paragraphs = [
    `Thank you for signing up for ${campaignName}! Your registration was successful.`,
    'Tap the button below to open your pass and view your QR code anytime.',
  ];

  return (
    <AutomationEmailLayout
      preview={subject}
      title={headline}
      customerName={customerName}
      paragraphs={paragraphs}
      ctaLabel="View your pass online"
      ctaUrl={passUrl}
    />
  );
}
