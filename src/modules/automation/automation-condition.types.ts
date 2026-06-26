import type { AutomationExecution } from '../../db/entities/automation-execution.entity';
import type { AutomationNode } from '../../db/entities/automation-node.entity';

export type AutomationConditionContext = {
  execution: AutomationExecution;
  node: AutomationNode;
  conditionType: string;
  config: Record<string, unknown>;
};

export type AutomationConditionEvaluator = {
  matches: (conditionType: string) => boolean;
  evaluate: (context: AutomationConditionContext) => Promise<boolean>;
};
