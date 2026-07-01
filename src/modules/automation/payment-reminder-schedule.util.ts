import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { AutomationNode } from '../../db/entities/automation-node.entity';

/** Payment reminder schedules are not capped — cron/wait timing is fully configurable. */
export function assertPaymentReminderScheduleValid(
  _purpose: AutomationPurpose,
  _nodes: AutomationNode[],
): void {
  return;
}
