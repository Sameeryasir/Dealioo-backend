import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';

export const GRAPH_EXECUTION_MODE = 'graph';

export function isGraphDrivenNodeConfig(
  config: Record<string, unknown> | null | undefined,
): boolean {
  if (!config || typeof config !== 'object') {
    return false;
  }
  return (
    config.executionMode === GRAPH_EXECUTION_MODE ||
    config.isCustomGraph === true
  );
}

export function isGraphDrivenAutomationNodes(
  nodes: Array<Pick<AutomationNode, 'type' | 'config'>> | null | undefined,
): boolean {
  if (!nodes?.length) {
    return false;
  }
  return nodes.some(
    (node) =>
      node.type === AutomationNodeType.TRIGGER &&
      isGraphDrivenNodeConfig(
        (node.config ?? {}) as Record<string, unknown>,
      ),
  );
}
