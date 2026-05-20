export { AbandonedCheckoutReminderEmail } from './abandoned-checkout-reminder-email';
export { GenericAutomationEmail } from './generic-automation-email';
export { PaymentConfirmationEmail } from './payment-confirmation-email';
export { PaymentReminderEmail } from './payment-reminder-email';
export { SignupWelcomeEmail } from './signup-welcome-email';
export { AutomationEmailLayout } from './components/email-layout';
export {
  AUTOMATION_EMAIL_TEMPLATE_IDS,
  normalizeAutomationTemplateKey,
  resolveAutomationEmailTemplateFromPurpose,
  resolveAutomationEmailTemplateId,
} from './registry';
export type {
  AutomationEmailRenderResult,
  AutomationEmailTemplateProps,
} from './types';
