import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { AutomationTrigger } from '../../db/entities/automation.entity';

export function resolvePurposeFromTrigger(
  trigger: AutomationTrigger,
): AutomationPurpose {
  switch (trigger) {
    case AutomationTrigger.CRON:
      return AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER;
    case AutomationTrigger.PAYMENT:
    case AutomationTrigger.FIRST_PURCHASE:
      return AutomationPurpose.FUNNEL_PAYMENT;
    case AutomationTrigger.ABANDONED_CHECKOUT:
      return AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER;
    case AutomationTrigger.SIGNUP:
    case AutomationTrigger.FUNNEL_COMPLETED:
    case AutomationTrigger.NO_VISIT:
    default:
      return AutomationPurpose.FUNNEL_SIGNUP;
  }
}
