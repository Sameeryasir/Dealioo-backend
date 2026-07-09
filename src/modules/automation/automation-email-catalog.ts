import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import {
  resolveAutomationEmailTemplateFromPurpose,
  resolveAutomationEmailTemplateId,
} from '../../templates/automation/registry';

export type PurposeEmailDefaults = {
  subject?: string;
  message?: string;
  headline?: string;
  ctaLabel?: string;
};

export function parseEmailNodeConfig(
  config: Record<string, unknown>,
): {
  subject: string;
  message?: string;
  headline?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  rawTemplate: string;
} {
  return {
    subject: String(config.subject ?? '').trim(),
    message: config.message
      ? String(config.message)
      : config.body
        ? String(config.body)
        : undefined,
    headline: config.headline ? String(config.headline) : undefined,
    ctaLabel: config.ctaLabel ? String(config.ctaLabel) : undefined,
    ctaUrl: config.ctaUrl ? String(config.ctaUrl) : undefined,
    rawTemplate: String(config.templateId ?? config.template ?? '').trim(),
  };
}

export function resolveEmailTemplateKey(
  purpose: AutomationPurpose,
  rawTemplate: string,
): string {
  if (
    purpose === AutomationPurpose.FUNNEL_SIGNUP ||
    purpose === AutomationPurpose.FUNNEL_PAYMENT
  ) {
    return resolveAutomationEmailTemplateFromPurpose(purpose);
  }
  if (rawTemplate) {
    return resolveAutomationEmailTemplateId(rawTemplate);
  }
  return resolveAutomationEmailTemplateFromPurpose(purpose);
}

export function getPurposeEmailDefaults(
  purpose: AutomationPurpose,
  campaignName: string,
): PurposeEmailDefaults {
  const campaign = campaignName.trim() || 'the campaign';

  switch (purpose) {
    case AutomationPurpose.FUNNEL_SIGNUP:
      return {
        subject: `Thanks for signing up on ${campaign}!`,
        message: `Thank you for signing up on ${campaign}! Your registration was successful and we are excited to have you with us. We will keep you updated on what happens next.`,
        headline: 'Thanks for signing up!',
      };
    case AutomationPurpose.FUNNEL_PAYMENT:
      return {
        subject: 'Thank you for trusting us — your payment is confirmed',
        message: `Thank you for trusting us. Your payment is confirmed for ${campaign}. Tap the button below to view your QR code and show it at the business.`,
        headline: 'Your payment is confirmed',
      };
    case AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER:
      return {
        subject: `Complete your payment — your offer is waiting`,
        message:
          'Hi — thank you for signing up! Your offer is almost ready. Please complete your payment to unlock it. If you already paid, you can ignore this email.',
        headline: 'Complete your payment',
        ctaLabel: 'Complete payment',
      };
    case AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER:
      return {
        subject: `Complete your checkout for ${campaign}`,
        message: `You started checkout for ${campaign} but did not finish. Your spot may still be available — complete payment when ready.`,
        headline: 'Complete your checkout',
      };
    default:
      return {};
  }
}

export function resolveSubjectForPurpose(
  purpose: AutomationPurpose,
  parsedSubject: string,
  campaignName: string,
  rawTemplate: string,
): string {
  const defaults = getPurposeEmailDefaults(purpose, campaignName);
  let subject = parsedSubject;

  if (purpose === AutomationPurpose.FUNNEL_SIGNUP && !subject) {
    subject = defaults.subject ?? subject;
  }

  const templateLooksAbandoned = rawTemplate.toLowerCase().includes('abandoned');
  if (
    purpose === AutomationPurpose.FUNNEL_PAYMENT &&
    (!subject || templateLooksAbandoned)
  ) {
    subject = defaults.subject ?? subject;
  }

  if (
    (purpose === AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER ||
      purpose === AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER) &&
    !subject
  ) {
    subject = defaults.subject ?? subject;
  }

  return subject;
}

export function getBrevoTemplateIdForPurpose(
  purpose: AutomationPurpose,
  env: {
    welcome?: string;
    paymentConfirmation?: string;
    abandonedPayment?: string;
  },
): number | undefined {
  const map: Partial<Record<AutomationPurpose, string | undefined>> = {
    [AutomationPurpose.FUNNEL_SIGNUP]: env.welcome,
    [AutomationPurpose.FUNNEL_PAYMENT]: env.paymentConfirmation,
    [AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER]: env.abandonedPayment,
    [AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER]: env.abandonedPayment,
  };

  const raw = map[purpose]?.trim();
  if (!raw) {
    return undefined;
  }
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

export function getTagsForPurpose(purpose: AutomationPurpose): string[] {
  switch (purpose) {
    case AutomationPurpose.FUNNEL_SIGNUP:
      return ['automation', 'welcome'];
    case AutomationPurpose.FUNNEL_PAYMENT:
      return ['automation', 'payment_confirmation'];
    case AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER:
    case AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER:
      return ['automation', 'payment_reminder'];
    default:
      return ['automation', String(purpose)];
  }
}

export function customerDisplayName(
  name: string | undefined,
  email: string,
): string {
  return name?.trim() || email.split('@')[0] || 'there';
}
