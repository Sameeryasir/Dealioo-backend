export type NodeExecutionStatus =
  | 'advance'
  | 'wait'
  | 'complete'
  | 'failed';

export type NodeExecutionResult = {
  status: NodeExecutionStatus;
  branchKey?: string | null;
  loopTargetNodeId?: number | null;
  outputs?: Record<string, unknown>;
};

export function nodeResult(
  status: NodeExecutionStatus,
  extras?: Omit<NodeExecutionResult, 'status'>,
): NodeExecutionResult {
  return { status, ...extras };
}

export function normalizeNodeResult(
  result: NodeExecutionResult | NodeExecutionStatus,
): NodeExecutionResult {
  if (typeof result === 'string') {
    return { status: result };
  }
  return result;
}

export const BRANCH_TRUE = 'TRUE';
export const BRANCH_FALSE = 'FALSE';
