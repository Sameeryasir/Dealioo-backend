import { AutomationNodeType } from '../../db/entities/automation-node.entity';
import {
  GRAPH_EXECUTION_MODE,
  isGraphDrivenAutomationNodes,
  isGraphDrivenNodeConfig,
} from './automation-graph-driven.util';

describe('automation-graph-driven.util', () => {
  it('detects graph execution mode on trigger config', () => {
    expect(
      isGraphDrivenNodeConfig({ executionMode: GRAPH_EXECUTION_MODE }),
    ).toBe(true);
    expect(isGraphDrivenNodeConfig({ isCustomGraph: true })).toBe(true);
    expect(isGraphDrivenNodeConfig({ trigger: 'signup' })).toBe(false);
  });

  it('detects graph-driven automations from trigger nodes only', () => {
    expect(
      isGraphDrivenAutomationNodes([
        {
          type: AutomationNodeType.TRIGGER,
          config: { trigger: 'cron', executionMode: GRAPH_EXECUTION_MODE },
        },
        {
          type: AutomationNodeType.EMAIL,
          config: { subject: 'Hello' },
        },
      ]),
    ).toBe(true);

    expect(
      isGraphDrivenAutomationNodes([
        {
          type: AutomationNodeType.TRIGGER,
          config: { trigger: 'signup' },
        },
      ]),
    ).toBe(false);
  });
});
