export type AutomationExecutionContext = {
  loopCount?: number;
  stepsProcessed?: number;
  branchMemory?: Record<string, unknown>;
  lastConditionType?: string | null;
  lastConditionResult?: boolean | null;
  stepHistoryPointer?: number | null;
  funnelPaymentId?: number | null;
  pausedFromStatus?: string;
  pausedAt?: string;
};

export type AutomationExecutionSnapshot = {
  currentNodeId: number;
  status: string;
  scheduledAt: string | null;
  automationVersion: number | null;
  executionContext: AutomationExecutionContext;
};

export function normalizeExecutionContext(
  raw: Record<string, unknown> | null | undefined,
): AutomationExecutionContext {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const rawPaymentId = raw.funnelPaymentId;
  const funnelPaymentId =
    typeof rawPaymentId === 'number' && Number.isFinite(rawPaymentId) && rawPaymentId > 0
      ? rawPaymentId
      : typeof rawPaymentId === 'string' &&
          Number.isFinite(Number(rawPaymentId)) &&
          Number(rawPaymentId) > 0
        ? Number(rawPaymentId)
        : null;

  return {
    loopCount:
      typeof raw.loopCount === 'number' && Number.isFinite(raw.loopCount)
        ? raw.loopCount
        : 0,
    stepsProcessed:
      typeof raw.stepsProcessed === 'number' && Number.isFinite(raw.stepsProcessed)
        ? raw.stepsProcessed
        : 0,
    branchMemory:
      raw.branchMemory && typeof raw.branchMemory === 'object'
        ? (raw.branchMemory as Record<string, unknown>)
        : {},
    lastConditionType:
      typeof raw.lastConditionType === 'string' ? raw.lastConditionType : null,
    lastConditionResult:
      typeof raw.lastConditionResult === 'boolean'
        ? raw.lastConditionResult
        : null,
    stepHistoryPointer:
      typeof raw.stepHistoryPointer === 'number' ? raw.stepHistoryPointer : null,
    ...(funnelPaymentId != null ? { funnelPaymentId } : {}),
    ...(typeof raw.pausedFromStatus === 'string'
      ? { pausedFromStatus: raw.pausedFromStatus }
      : {}),
    ...(typeof raw.pausedAt === 'string' ? { pausedAt: raw.pausedAt } : {}),
  };
}

export function buildExecutionSnapshot(
  execution: {
    currentNodeId: number;
    status: string;
    scheduledAt: Date | null;
    automationVersion: number | null;
    executionContext?: Record<string, unknown> | null;
  },
): AutomationExecutionSnapshot {
  return {
    currentNodeId: execution.currentNodeId,
    status: execution.status,
    scheduledAt: execution.scheduledAt?.toISOString() ?? null,
    automationVersion: execution.automationVersion ?? null,
    executionContext: normalizeExecutionContext(execution.executionContext),
  };
}
