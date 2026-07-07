export function isCustomerVisitedCondition(conditionType: string): boolean {
  const normalized = conditionType.trim().toLowerCase();
  return (
    normalized.includes('customer visited') ||
    normalized.includes('visited restaurant') ||
    normalized === 'visit_completed'
  );
}
