import {
  dedupeBusinessOrderEventRows,
  mergeBusinessOrderRowsByCheckout,
  resolveBusinessEventPaymentSortDate,
  sortBusinessFunnelEventsByPaymentDate,
} from './business-funnel-events-filters.util';
import { FunnelEventType } from '../../db/entities/funnel-event.entity';

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

  it('sorts by paidAt even when a later visit exists (matches Payment Date column)', () => {
    const paidAt = new Date('2026-07-22T01:39:00.000Z');
    const visitedAt = new Date('2026-07-22T06:30:00.000Z');
    const laterPaidAt = new Date('2026-07-22T06:10:00.000Z');

    const sorted = sortBusinessFunnelEventsByPaymentDate([
      {
        id: 1,
        createdAt: '2026-07-22T01:00:00.000Z',
        paidAt,
        businessVisitedAt: visitedAt,
      },
      {
        id: 2,
        createdAt: '2026-07-22T06:00:00.000Z',
        paidAt: laterPaidAt,
        businessVisitedAt: null,
      },
    ]);

    expect(sorted.map((row) => row.id)).toEqual([2, 1]);
    expect(
      resolveBusinessEventPaymentSortDate({
        createdAt: '2026-07-22T01:00:00.000Z',
        paidAt,
        businessVisitedAt: visitedAt,
      }),
    ).toBe(paidAt.getTime());
  });
});

describe('dedupeBusinessOrderEventRows', () => {
  it('keeps payment and drops signup for the same guest + funnel', () => {
    const rows = dedupeBusinessOrderEventRows([
      {
        eventType: FunnelEventType.SIGNUP,
        funnelId: 10,
        customer: { id: 5 },
        funnelPaymentId: null,
        id: 1,
      },
      {
        eventType: FunnelEventType.PAYMENT,
        funnelId: 10,
        customer: { id: 5 },
        funnelPaymentId: 99,
        id: 2,
      },
    ]);

    expect(rows.map((row) => row.id)).toEqual([2]);
  });

  it('keeps unpaid signup when no payment exists', () => {
    const rows = dedupeBusinessOrderEventRows([
      {
        eventType: FunnelEventType.SIGNUP,
        funnelId: 10,
        customer: { id: 5 },
        funnelPaymentId: null,
        id: 1,
      },
    ]);

    expect(rows.map((row) => row.id)).toEqual([1]);
  });

  it('keeps only one row per funnelPaymentId', () => {
    const rows = dedupeBusinessOrderEventRows([
      {
        eventType: FunnelEventType.PAYMENT,
        funnelId: 10,
        customer: { id: 5 },
        funnelPaymentId: 99,
        id: 1,
      },
      {
        eventType: FunnelEventType.PAYMENT,
        funnelId: 10,
        customer: { id: 5 },
        funnelPaymentId: 99,
        id: 2,
      },
    ]);

    expect(rows.map((row) => row.id)).toEqual([1]);
  });
});

describe('mergeBusinessOrderRowsByCheckout', () => {
  it('keeps separate rows when pays are different checkouts', () => {
    const rows = mergeBusinessOrderRowsByCheckout([
      {
        id: 1,
        rowKey: 'event:1',
        eventType: FunnelEventType.PAYMENT,
        createdAt: new Date('2026-07-22T10:00:00.000Z'),
        funnelId: 10,
        campaignId: 1,
        campaignName: 'Burger',
        customer: { id: 5, name: 'Sam', email: 'sam@test.com', phone: null },
        customerEmail: 'sam@test.com',
        amount: 1200,
        currency: 'usd',
        paymentStatus: 'paid',
        receiptUrl: null,
        orderStatus: 'paid_online',
        onlineAmountCents: 1200,
        businessAmount: null,
        businessVisitedAt: null,
        paidAt: new Date('2026-07-22T10:00:00.000Z'),
        funnelPaymentId: 100,
        paymentCollectedAt: null,
      },
      {
        id: 2,
        rowKey: 'event:2',
        eventType: FunnelEventType.PAYMENT,
        createdAt: new Date('2026-07-22T12:00:00.000Z'),
        funnelId: 10,
        campaignId: 1,
        campaignName: 'Burger',
        customer: { id: 5, name: 'Sam', email: 'sam@test.com', phone: null },
        customerEmail: 'sam@test.com',
        amount: 1200,
        currency: 'usd',
        paymentStatus: 'paid',
        receiptUrl: null,
        orderStatus: 'paid_online',
        onlineAmountCents: 1200,
        businessAmount: null,
        businessVisitedAt: null,
        paidAt: new Date('2026-07-22T12:00:00.000Z'),
        funnelPaymentId: 101,
        paymentCollectedAt: null,
      },
    ]);

    expect(rows).toHaveLength(2);
  });

  it('combines multi-funnel pays from the same checkout', () => {
    const collectedAt = new Date('2026-07-22T12:00:00.000Z');
    const rows = mergeBusinessOrderRowsByCheckout([
      {
        id: 1,
        rowKey: 'event:1',
        eventType: FunnelEventType.PAYMENT,
        createdAt: collectedAt,
        funnelId: 10,
        campaignId: 1,
        campaignName: 'Burger',
        customer: { id: 5, name: 'Sam', email: 'sam@test.com', phone: null },
        customerEmail: 'sam@test.com',
        amount: 1200,
        currency: 'usd',
        paymentStatus: 'paid',
        receiptUrl: null,
        orderStatus: 'paid_both',
        onlineAmountCents: 1200,
        businessAmount: 17,
        businessVisitedAt: null,
        paidAt: collectedAt,
        funnelPaymentId: 100,
        paymentCollectedAt: collectedAt,
      },
      {
        id: 2,
        rowKey: 'event:2',
        eventType: FunnelEventType.PAYMENT,
        createdAt: collectedAt,
        funnelId: 11,
        campaignId: 2,
        campaignName: 'Pizza',
        customer: { id: 5, name: 'Sam', email: 'sam@test.com', phone: null },
        customerEmail: 'sam@test.com',
        amount: 1500,
        currency: 'usd',
        paymentStatus: 'paid',
        receiptUrl: null,
        orderStatus: 'paid_both',
        onlineAmountCents: 1500,
        businessAmount: 20,
        businessVisitedAt: null,
        paidAt: collectedAt,
        funnelPaymentId: 101,
        paymentCollectedAt: collectedAt,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].onlineAmountCents).toBe(2700);
    expect(rows[0].businessAmount).toBe(37);
    expect(rows[0].campaignName).toBe('Burger, Pizza');
  });
});
