import { CouponStatus, CouponPaymentStatus } from '../../db/entities/coupon.entity';
import { ScannerPurchaseMeans } from './funnelEventDto/scanner-purchase-deals.dto';
import { finalizeScannerPurchaseEssentials } from './scanner-purchase-finalize.util';

describe('finalizeScannerPurchaseEssentials', () => {
  it('marks unpaid online passes redeemed inside the transaction manager', async () => {
    const coupon = {
      id: 11,
      status: CouponStatus.ACTIVE,
      paymentStatus: CouponPaymentStatus.PENDING,
      expiresAt: null,
    };

    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(coupon)
        .mockResolvedValueOnce(coupon),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue({ id: 99 }),
      create: jest.fn((_entity, data) => data),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const purchased = await finalizeScannerPurchaseEssentials(manager as never, {
      businessId: 1,
      customerId: 2,
      staffUserId: 3,
      orderId: 4,
      collectedAt: new Date('2026-01-01T00:00:00.000Z'),
      purchaseMeans: ScannerPurchaseMeans.IN_PERSON,
      deals: [
        {
          funnel: {
            id: 7,
            campaign: { id: 8, campaignName: 'Lunch Deal' },
          } as never,
          paymentId: 5,
        },
      ],
      visitOrderSubtotalDollars: null,
      normalizedExtraItems: [],
    });

    expect(manager.update).toHaveBeenCalled();
    expect(purchased).toEqual([
      {
        funnelId: 7,
        campaignName: 'Lunch Deal',
        couponId: 11,
        purchaseMeans: ScannerPurchaseMeans.IN_PERSON,
      },
    ]);
  });
});
