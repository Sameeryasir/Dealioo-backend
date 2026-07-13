import {
  resolveBusinessEventPaymentSortDate,
  sortBusinessFunnelEventsByPaymentDate,
} from './business-funnel-events-filters.util';

describe('business funnel event payment sort', () => {
  it('prefers paidAt over event createdAt', () => {
    const paidAt = new Date('2026-07-13T20:27:00.000Z');
    const createdAt = new Date('2026-07-13T19:18:44.000Z');

    expect(
      resolveBusinessEventPaymentSortDate({
        createdAt,
        paidAt,
        businessVisitedAt: null,
      }),
    ).toBe(paidAt.getTime());
  });

  it('sorts paid events newest payment date first', () => {
    const sorted = sortBusinessFunnelEventsByPaymentDate([
      {
        id: 1,
        createdAt: '2026-07-12T19:43:30.000Z',
        paidAt: '2026-07-13T20:11:54.000Z',
        businessVisitedAt: null,
      },
      {
        id: 2,
        createdAt: '2026-07-13T19:18:44.000Z',
        paidAt: '2026-07-13T20:27:00.000Z',
        businessVisitedAt: null,
      },
    ]);

    expect(sorted.map((row) => row.id)).toEqual([2, 1]);
  });

  it('uses walk-in visit date when no online paidAt exists', () => {
    const visitedAt = new Date('2026-07-10T15:00:00.000Z');
    const createdAt = new Date('2026-07-09T12:17:00.000Z');

    expect(
      resolveBusinessEventPaymentSortDate({
        createdAt,
        paidAt: null,
        businessVisitedAt: visitedAt,
      }),
    ).toBe(visitedAt.getTime());
  });
});
