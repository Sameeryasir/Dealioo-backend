import * as React from 'react';
import { AutomationEmailLayout } from './automation/components/email-layout';

export type MemberInviteEmailProps = {
  businessName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresInDays: number;
  permissions?: string[];
};

export function MemberInviteEmail({
  businessName,
  inviterName,
  role,
  acceptUrl,
  expiresInDays,
  permissions = [],
}: MemberInviteEmailProps) {
  const dayLabel = expiresInDays === 1 ? 'day' : 'days';
  const permissionLine =
    permissions.length > 0
      ? permissions.map((permission) => permission.replace(/_/g, ' ')).join(', ')
      : null;

  const paragraphs = [
    `${inviterName} invited you to join ${businessName} as a ${role}.`,
    permissionLine
      ? `You will have access to: ${permissionLine}.`
      : null,
    `Click the button below to accept the invitation. This link expires in ${expiresInDays} ${dayLabel}.`,
    'If you did not expect this email, you can safely ignore it.',
  ].filter((paragraph): paragraph is string => Boolean(paragraph));

  return (
    <AutomationEmailLayout
      preview={`${inviterName} invited you to join ${businessName} on Dealioo`}
      title="You're invited"
      customerName="there"
      skipGreeting
      paragraphs={paragraphs}
      ctaLabel="Accept invitation"
      ctaUrl={acceptUrl}
    />
  );
}
