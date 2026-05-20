import * as React from 'react';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { AbandonedCheckoutReminderEmail } from './abandoned-checkout-reminder-email';
import { GenericAutomationEmail } from './generic-automation-email';
import { PaymentReminderEmail } from './payment-reminder-email';
import type { AutomationEmailTemplateProps } from './types';

export const AUTOMATION_EMAIL_TEMPLATE_IDS = {
  ABANDONED_CHECKOUT_REMINDER: 'abandoned_checkout_reminder',
  FUNNEL_SIGNUP_PAYMENT_REMINDER: 'funnel_signup_payment_reminder',
  PAYMENT_REMINDER: 'payment_reminder',
  GENERIC: 'generic',
} as const;

export type AutomationEmailTemplateId =
  (typeof AUTOMATION_EMAIL_TEMPLATE_IDS)[keyof typeof AUTOMATION_EMAIL_TEMPLATE_IDS];

type AutomationEmailComponent = (
  props: AutomationEmailTemplateProps,
) => React.JSX.Element;

const TEMPLATE_ALIASES: Record<string, AutomationEmailTemplateId> = {
  abandoned_checkout_reminder: AUTOMATION_EMAIL_TEMPLATE_IDS.ABANDONED_CHECKOUT_REMINDER,
  abandoned_checkout: AUTOMATION_EMAIL_TEMPLATE_IDS.ABANDONED_CHECKOUT_REMINDER,
  funnel_signup_payment_reminder:
    AUTOMATION_EMAIL_TEMPLATE_IDS.FUNNEL_SIGNUP_PAYMENT_REMINDER,
  payment_reminder: AUTOMATION_EMAIL_TEMPLATE_IDS.PAYMENT_REMINDER,
  signup_payment_reminder: AUTOMATION_EMAIL_TEMPLATE_IDS.PAYMENT_REMINDER,
  generic: AUTOMATION_EMAIL_TEMPLATE_IDS.GENERIC,
};

const TEMPLATE_COMPONENTS: Record<
  AutomationEmailTemplateId,
  AutomationEmailComponent
> = {
  [AUTOMATION_EMAIL_TEMPLATE_IDS.ABANDONED_CHECKOUT_REMINDER]:
    AbandonedCheckoutReminderEmail,
  [AUTOMATION_EMAIL_TEMPLATE_IDS.FUNNEL_SIGNUP_PAYMENT_REMINDER]:
    PaymentReminderEmail,
  [AUTOMATION_EMAIL_TEMPLATE_IDS.PAYMENT_REMINDER]: PaymentReminderEmail,
  [AUTOMATION_EMAIL_TEMPLATE_IDS.GENERIC]: GenericAutomationEmail,
};

export function normalizeAutomationTemplateKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function resolveAutomationEmailTemplateId(
  rawTemplate: string,
): AutomationEmailTemplateId {
  const normalized = normalizeAutomationTemplateKey(rawTemplate);
  return (
    TEMPLATE_ALIASES[normalized] ?? AUTOMATION_EMAIL_TEMPLATE_IDS.GENERIC
  );
}

export function getAutomationEmailComponent(
  templateId: AutomationEmailTemplateId,
): AutomationEmailComponent {
  return TEMPLATE_COMPONENTS[templateId];
}

export function resolveAutomationEmailTemplateFromPurpose(
  purpose: AutomationPurpose,
): AutomationEmailTemplateId {
  switch (purpose) {
    case AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER:
      return AUTOMATION_EMAIL_TEMPLATE_IDS.ABANDONED_CHECKOUT_REMINDER;
    case AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER:
    case AutomationPurpose.FUNNEL_SIGNUP:
      return AUTOMATION_EMAIL_TEMPLATE_IDS.FUNNEL_SIGNUP_PAYMENT_REMINDER;
    case AutomationPurpose.FUNNEL_PAYMENT:
      return AUTOMATION_EMAIL_TEMPLATE_IDS.PAYMENT_REMINDER;
    default:
      return AUTOMATION_EMAIL_TEMPLATE_IDS.GENERIC;
  }
}
