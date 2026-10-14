export function pickEligibleCustomerIdsForBatchStart(options: {
  customerIds: number[];
  liveIds: Set<number>;
  completedIds?: Set<number>;
  remainingCap: number;
}): {
  eligible: number[];
  skipped: number;
  hitCap: boolean;
} {
  const completedIds = options.completedIds ?? new Set<number>();
  const remainingCap = options.remainingCap;
  if (!(remainingCap > 0) && remainingCap !== Number.POSITIVE_INFINITY) {
    return { eligible: [], skipped: 0, hitCap: true };
  }

  let skipped = 0;
  const eligible: number[] = [];
  let hitCap = false;

  for (const customerId of options.customerIds) {
    if (!(Number.isFinite(customerId) && customerId > 0)) {
      continue;
    }
    if (options.liveIds.has(customerId) || completedIds.has(customerId)) {
      skipped += 1;
      continue;
    }
    if (eligible.length >= remainingCap) {
      hitCap = true;
      break;
    }
    eligible.push(customerId);
  }

  return { eligible, skipped, hitCap };
}
