import type { EntityManager } from 'typeorm';
import type { Campaign } from '../../db/entities/campaign.entity';
import {
  Coupon,
  CouponPaymentStatus,
  CouponStatus,
} from '../../db/entities/coupon.entity';
import {
  CustomerVisit,
  CustomerVisitSource,
} from '../../db/entities/customer-visit.entity';
import type { Funnel } from '../../db/entities/funnel.entity';
import { VisitAddonItemSource } from '../../db/entities/visit-addon-item.entity';
import { replaceVisitAddonItems } from '../../utils/visit-addon-items.util';
import type { ScannerPurchaseMeans } from './funnelEventDto/scanner-purchase-deals.dto';

export type ScannerPurchasedDealResult = {
  funnelId: number;
  campaignName: string;
  couponId: number | null;
  purchaseMeans: ScannerPurchaseMeans;
};

type PendingPurchaseDeal = {
  funnel: Funnel & { campaign: Campaign };
  paymentId: number;
};

type ExtraItem = { name: string; unitPrice: number; qty: number };

function isExpiredCoupon(coupon: Coupon, now = new Date()): boolean {
  if (!coupon.expiresAt) return false;
  return coupon.expiresAt.getTime() <= now.getTime();
}

async function findCouponForCustomerFunnel(
  manager: EntityManager,
  customerId: number,
  funnelId: number,
): Promise<Coupon | null> {
  const pending = await manager.findOne(Coupon, {
    where: {
      customerId,
      funnelId,
      status: CouponStatus.ACTIVE,
      paymentStatus: CouponPaymentStatus.PENDING,
    },
    order: { id: 'DESC' },
  });
  if (pending && !isExpiredCoupon(pending)) {
    return pending;
  }

  const active = await manager.findOne(Coupon, {
    where: {
      customerId,
      funnelId,
      status: CouponStatus.ACTIVE,
    },
    order: { id: 'DESC' },
  });
  if (active && !isExpiredCoupon(active)) {
    return active;
  }

  return manager.findOne(Coupon, {
    where: { customerId, funnelId },
    order: { id: 'DESC' },
  });
}

async function consumeUnpaidPassInTransaction(
  manager: EntityManager,
  params: {
    couponId: number;
    funnelPaymentId: number;
    staffUserId: number;
    redeemedAt: Date;
  },
): Promise<Coupon | null> {
  const coupon = await manager.findOne(Coupon, {
    where: { id: params.couponId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!coupon) {
    return null;
  }
  if (
    coupon.status === CouponStatus.REDEEMED ||
    coupon.status === CouponStatus.REVOKED ||
    coupon.status === CouponStatus.EXPIRED
  ) {
    return coupon;
  }

  await manager.update(Coupon, coupon.id, {
    funnelPaymentId: params.funnelPaymentId,
    paymentStatus: CouponPaymentStatus.PAID,
    status: CouponStatus.REDEEMED,
    redeemedAt: params.redeemedAt,
    redeemedByUserId: params.staffUserId,
  });

  coupon.funnelPaymentId = params.funnelPaymentId;
  coupon.paymentStatus = CouponPaymentStatus.PAID;
  coupon.status = CouponStatus.REDEEMED;
  coupon.redeemedAt = params.redeemedAt;
  coupon.redeemedByUserId = params.staffUserId;
  return coupon;
}

export async function finalizeScannerPurchaseEssentials(
  manager: EntityManager,
  params: {
    businessId: number;
    customerId: number;
    staffUserId: number;
    orderId: number | null;
    collectedAt: Date;
    purchaseMeans: ScannerPurchaseMeans;
    deals: PendingPurchaseDeal[];
    visitOrderSubtotalDollars: number | null;
    normalizedExtraItems: ExtraItem[];
  },
): Promise<ScannerPurchasedDealResult[]> {
  const purchased: ScannerPurchasedDealResult[] = [];
  const visitCampaignIds = [
    ...new Set(params.deals.map((deal) => deal.funnel.campaign.id)),
  ];

  for (const deal of params.deals) {
    const { funnel, paymentId } = deal;
    const funnelId = funnel.id;

    const existingPass = await findCouponForCustomerFunnel(
      manager,
      params.customerId,
      funnelId,
    );
    const hasUnpaidOnlinePass =
      existingPass != null &&
      existingPass.status === CouponStatus.ACTIVE &&
      existingPass.paymentStatus === CouponPaymentStatus.PENDING &&
      !isExpiredCoupon(existingPass);

    if (hasUnpaidOnlinePass && existingPass) {
      const consumed = await consumeUnpaidPassInTransaction(manager, {
        couponId: existingPass.id,
        funnelPaymentId: paymentId,
        staffUserId: params.staffUserId,
        redeemedAt: params.collectedAt,
      });

      purchased.push({
        funnelId,
        campaignName: funnel.campaign.campaignName,
        couponId: consumed?.id ?? existingPass.id,
        purchaseMeans: params.purchaseMeans,
      });
      continue;
    }

    purchased.push({
      funnelId,
      campaignName: funnel.campaign.campaignName,
      couponId: null,
      purchaseMeans: params.purchaseMeans,
    });
  }

  if (visitCampaignIds.length > 0) {
    const primaryCampaignId = visitCampaignIds[0];
    const savedVisit = await manager.save(
      manager.create(CustomerVisit, {
        customerId: params.customerId,
        campaignId: primaryCampaignId,
        businessId: params.businessId,
        couponId: null,
        orderId: params.orderId,
        staffUserId: params.staffUserId,
        visitedAt: params.collectedAt,
        source: CustomerVisitSource.STAFF_LOOKUP,
        orderSubtotal: params.visitOrderSubtotalDollars,
        extraItems:
          params.visitOrderSubtotalDollars != null &&
          params.visitOrderSubtotalDollars > 0
            ? params.normalizedExtraItems
            : null,
        visitCampaigns: visitCampaignIds.map((campaignId) => ({
          campaignId,
        })),
      }),
    );

    await replaceVisitAddonItems(manager, {
      customerVisitId: savedVisit.id,
      businessId: params.businessId,
      customerId: params.customerId,
      campaignId: primaryCampaignId,
      orderId: params.orderId,
      staffUserId: params.staffUserId,
      source: VisitAddonItemSource.SCANNER_PURCHASE,
      items:
        params.visitOrderSubtotalDollars != null &&
        params.visitOrderSubtotalDollars > 0
          ? params.normalizedExtraItems
          : [],
    });
  }

  return purchased;
}
