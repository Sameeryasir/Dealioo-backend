import * as React from 'react';
import { AutomationEmailLayout } from './automation/components/email-layout';

export type SetPasswordEmailProps = {
  name: string;
  email: string;
  setPasswordUrl: string;
  businessName?: string | null;
};

export function SetPasswordEmail({
  name,
  email,
  setPasswordUrl,
  businessName,
}: SetPasswordEmailProps) {
  const greetingName = name?.trim() || email.split('@')[0] || 'there';
  const businessLine = businessName?.trim()
    ? `Your business (${businessName.trim()}) is ready on Dealioo.`
    : 'Your Dealioo account is ready.';

  return (
    <AutomationEmailLayout
      preview="Set your Dealioo password to access your account"
      title="Set your password"
      customerName={greetingName}
      paragraphs={[
        businessLine,
        'Use the button below to choose a password and sign in. You will receive a short verification code on the next step — the same secure flow used when resetting a password.',
        'If you did not expect this email, you can safely ignore it.',
      ]}
      ctaLabel="Set password"
      ctaUrl={setPasswordUrl}
    />
  );
}
