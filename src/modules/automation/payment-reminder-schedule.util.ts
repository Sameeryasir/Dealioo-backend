import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { AutomationNode } from '../../db/entities/automation-node.entity';

export function assertPaymentReminderScheduleValid(
  _purpose: AutomationPurpose,
  _nodes: AutomationNode[],
): void {
  return;
}
