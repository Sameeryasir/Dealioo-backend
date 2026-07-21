import { FunnelEventType } from '../../db/entities/funnel-event.entity';
import { FunnelPaymentStatus } from '../../db/entities/funnel-payment.entity';
import {
  buildBusinessOrderPaymentSummary,
  isConfirmedOnlinePayment,
} from './business-order-payment.util';
import {
  matchesBusinessEventStatusFilter,
  resolveBusinessEventDisplayStatus,
} from './business-funnel-events-filters.util';

describe('business order payment summary', () => {
  it('does not treat pending checkout amounts as paid online', () => {
    const summary = buildBusinessOrderPaymentSummary(
      {
        eventType: FunnelEventType.PAYMENT,
        amount: 2200,
        paymentStatus: FunnelPaymentStatus.PENDING,
      },
      null,
    );

    expect(summary.orderStatus).toBe('not_paid');
    expect(summary.onlineAmountCents).toBeNull();
  });

  it('treats confirmed paid payments as paid online', () => {
    const summary = buildBusinessOrderPaymentSummary(
      {
        eventType: FunnelEventType.PAYMENT,
        amount: 2200,
        paymentStatus: FunnelPaymentStatus.PAID,
      },
      null,
      { paidAt: new Date('2026-07-13T20:27:00.000Z') },
    );

    expect(summary.orderStatus).toBe('paid_online');
    expect(summary.onlineAmountCents).toBe(2200);
  });

  it('marks QR visit even when order subtotal is missing', () => {
    const visitedAt = new Date('2026-07-21T15:15:00.000Z');
    const summary = buildBusinessOrderPaymentSummary(
      {
        eventType: FunnelEventType.PAYMENT,
        amount: 1200,
        paymentStatus: FunnelPaymentStatus.PAID,
      },
      { orderSubtotal: null, visitedAt },
      { paidAt: visitedAt },
    );

    expect(summary.businessVisitedAt).toEqual(visitedAt);
    expect(summary.businessAmount).toBeNull();
    expect(summary.orderStatus).toBe('paid_online');
  });
});

describe('business event paid filter', () => {
  it('excludes pending payments from paid filter', () => {
    const displayStatus = resolveBusinessEventDisplayStatus({
      paymentStatus: FunnelPaymentStatus.PENDING,
      orderStatus: 'not_paid',
      paidAt: null,
    });

    expect(displayStatus).toBe('pending');
    expect(matchesBusinessEventStatusFilter(displayStatus, 'paid')).toBe(false);
  });

  it('includes rows with paidAt even when event created earlier', () => {
    const displayStatus = resolveBusinessEventDisplayStatus({
      paymentStatus: FunnelPaymentStatus.PAID,
      orderStatus: 'paid_online',
      paidAt: '2026-07-13T20:27:00.000Z',
    });

    expect(displayStatus).toBe('paid');
    expect(matchesBusinessEventStatusFilter(displayStatus, 'paid')).toBe(true);
  });

  it('detects confirmed online payment helper', () => {
    expect(
      isConfirmedOnlinePayment({
        paymentStatus: FunnelPaymentStatus.PENDING,
        paidAt: null,
      }),
    ).toBe(false);
    expect(
      isConfirmedOnlinePayment({
        paymentStatus: FunnelPaymentStatus.PAID,
        paidAt: null,
      }),
    ).toBe(true);
  });
});
