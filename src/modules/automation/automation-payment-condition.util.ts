export function isUnpaidGuestCondition(conditionType: string): boolean {
  const normalized = conditionType.trim().toLowerCase();
  return (
    normalized.includes('not prepaid') ||
    normalized.includes('not completed payment') ||
    normalized.includes('not paid') ||
    normalized === 'payment_not_paid' ||
    normalized === 'payment_pending'
  );
}

export function hasConditionLoopRestartConfig(
  config: Record<string, unknown>,
): boolean {
  return String(config.onFalseLoopWorkflowKind ?? '').trim().length > 0;
}
