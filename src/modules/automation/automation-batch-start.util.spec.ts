import { pickEligibleCustomerIdsForBatchStart } from './automation-batch-start.util';

describe('pickEligibleCustomerIdsForBatchStart', () => {
  it('skips live and completed guests then respects remaining cap', () => {
    const result = pickEligibleCustomerIdsForBatchStart({
      customerIds: [1, 2, 3, 4, 5],
      liveIds: new Set([2]),
      completedIds: new Set([4]),
      remainingCap: 2,
    });

    expect(result.eligible).toEqual([1, 3]);
    expect(result.skipped).toBe(2);
    expect(result.hitCap).toBe(true);
  });

  it('returns all eligible when under cap', () => {
    const result = pickEligibleCustomerIdsForBatchStart({
      customerIds: [10, 20],
      liveIds: new Set(),
      remainingCap: 50,
    });

    expect(result.eligible).toEqual([10, 20]);
    expect(result.skipped).toBe(0);
    expect(result.hitCap).toBe(false);
  });
});
