import type { AutomationExecution } from '../../../db/entities/automation-execution.entity';
import type {
  AutomationNode,
  AutomationNodeType,
} from '../../../db/entities/automation-node.entity';
import type { AutomationExecutionContext } from '../automation-execution-context.types';
import type { NodeExecutionResult } from './automation-node-result.types';

export type AutomationNodeHandlerContext = {
  execution: AutomationExecution;
  node: AutomationNode;
  executionContext: AutomationExecutionContext;
};

export interface AutomationNodeHandler {
  readonly type: AutomationNodeType;
  execute(context: AutomationNodeHandlerContext): Promise<NodeExecutionResult>;
}
