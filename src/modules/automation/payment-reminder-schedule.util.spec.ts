import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import { assertPaymentReminderScheduleValid } from './payment-reminder-schedule.util';

function node(
  partial: Partial<AutomationNode> & Pick<AutomationNode, 'id' | 'type' | 'order'>,
): AutomationNode {
  return {
    automationId: 1,
    config: {},
    positionX: 0,
    positionY: 0,
    ...partial,
  } as AutomationNode;
}

describe('assertPaymentReminderScheduleValid', () => {
  it('does not enforce cron vs wait limits', () => {
    const nodes: AutomationNode[] = [
      node({
        id: 1,
        type: AutomationNodeType.TRIGGER,
        order: 0,
        config: {
          trigger: 'cron',
          frequency: 'interval',
          interval: 5,
          unit: 'minutes',
        },
      }),
      node({ id: 2, type: AutomationNodeType.EMAIL, order: 1, config: {} }),
      node({
        id: 3,
        type: AutomationNodeType.WAIT,
        order: 2,
        config: { delay: 15, unit: 'minutes' },
      }),
      node({ id: 4, type: AutomationNodeType.EMAIL, order: 3, config: {} }),
    ];

    expect(() =>
      assertPaymentReminderScheduleValid(
        AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER,
        nodes,
      ),
    ).not.toThrow();
  });
});
