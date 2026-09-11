import * as React from 'react';
import { AutomationEmailLayout } from './automation/components/email-layout';

export type MemberAccessRemovedEmailProps = {
  businessName: string;
  removedByName: string;
  kind: 'member' | 'invite';
};

export function MemberAccessRemovedEmail({
  businessName,
  removedByName,
  kind,
}: MemberAccessRemovedEmailProps) {
  const paragraphs =
    kind === 'invite'
      ? [
          `${removedByName} cancelled your invitation to join ${businessName} on Dealioo.`,
          'You will no longer be able to join this business with that invite.',
        ]
      : [
          `${removedByName} removed your access to ${businessName} on Dealioo.`,
          'You will no longer see this business in your dashboard.',
        ];

  return (
    <AutomationEmailLayout
      preview={
        kind === 'invite'
          ? `Your invitation to ${businessName} was cancelled`
          : `Your access to ${businessName} was removed`
      }
      title={kind === 'invite' ? 'Invitation cancelled' : 'Access removed'}
      customerName="there"
      skipGreeting
      paragraphs={paragraphs}
    />
  );
}
