import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import {
  Coupon,
  CouponPaymentStatus,
  CouponStatus,
} from '../../db/entities/coupon.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';

/** Default pass validity after issuance (90 days). */
const COUPON_VALIDITY_DAYS = 90;

export type IssueSignupCouponResult = {
  coupon: Coupon | null;
  created: boolean;
};

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(
    @InjectRepository(Coupon)
    private readonly couponRepository: Repository<Coupon>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  async issueFromSignup(
    funnelId: number,
    customerId: number,
  ): Promise<IssueSignupCouponResult> {
    const existing = await this.findByCustomerAndFunnel(customerId, funnelId);
    if (existing) {
      return { coupon: existing, created: false };
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
      relations: ['campaign'],
    });
    if (!funnel?.campaign) {
      return { coupon: null, created: false };
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    expiresAt.setDate(expiresAt.getDate() + COUPON_VALIDITY_DAYS);

    const coupon = this.couponRepository.create({
      campaignId: funnel.campaign.id,
      funnelId,
      restaurantId: funnel.campaign.restaurantId,
      customerId,
      funnelPaymentId: null,
      qrToken: randomUUID(),
      status: CouponStatus.ACTIVE,
      paymentStatus: CouponPaymentStatus.PENDING,
      issuedAt,
      expiresAt,
    });

    try {
      const saved = await this.couponRepository.save(coupon);
      return { coupon: saved, created: true };
    } catch (err) {
      const raced = await this.findByCustomerAndFunnel(customerId, funnelId);
      if (raced) {
        return { coupon: raced, created: false };
      }
      this.logger.warn(
        `Failed to issue signup coupon for customer ${customerId}`,
        err,
      );
      return { coupon: null, created: false };
    }
  }

  async findByCustomerAndFunnel(
    customerId: number,
    funnelId: number,
  ): Promise<Coupon | null> {
    const coupons = await this.couponRepository.find({
      where: { customerId, funnelId },
      relations: ['customer', 'campaign', 'funnelPayment'],
      order: { id: 'DESC' },
      take: 1,
    });
    return coupons[0] ?? null;
  }

  /** Attach the signup pass to a pending checkout session. */
  async linkSignupCouponToPayment(
    customerId: number,
    funnelId: number,
    funnelPaymentId: number,
  ): Promise<Coupon | null> {
    const coupon = await this.findByCustomerAndFunnel(customerId, funnelId);
    if (!coupon) {
      return null;
    }

    if (
      coupon.funnelPaymentId != null &&
      coupon.funnelPaymentId !== funnelPaymentId
    ) {
      return coupon;
    }

    if (coupon.funnelPaymentId !== funnelPaymentId) {
      await this.couponRepository.update(coupon.id, { funnelPaymentId });
      coupon.funnelPaymentId = funnelPaymentId;
    }

    await this.syncPaymentStatusFromFunnelPayment(coupon);
    return coupon;
  }

  /** Issue or upgrade a coupon when checkout completes (idempotent). */
  async issueFromPayment(
    funnelPaymentId: number,
    funnelId: number,
    customerId: number,
  ): Promise<Coupon | null> {
    const existing = await this.couponRepository.findOne({
      where: { funnelPaymentId },
      relations: ['customer', 'campaign', 'funnelPayment'],
    });
    if (existing) {
      await this.syncPaymentStatusFromFunnelPayment(existing);
      return existing;
    }

    const payment = await this.funnelPaymentRepository.findOne({
      where: { id: funnelPaymentId, funnelId },
    });
    if (!payment) {
      return null;
    }

    const signupCoupon = await this.findByCustomerAndFunnel(
      customerId,
      funnelId,
    );

    if (signupCoupon) {
      const paymentStatus =
        payment.status === FunnelPaymentStatus.PAID
          ? CouponPaymentStatus.PAID
          : this.mapFunnelPaymentToCouponStatus(payment.status);

      await this.couponRepository.update(signupCoupon.id, {
        funnelPaymentId,
        paymentStatus,
      });

      signupCoupon.funnelPaymentId = funnelPaymentId;
      signupCoupon.paymentStatus = paymentStatus;
      return signupCoupon;
    }

    if (payment.status !== FunnelPaymentStatus.PAID) {
      return null;
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel?.campaignId) {
      return null;
    }

    const campaign = await this.campaignRepository.findOne({
      where: { id: funnel.campaignId },
    });
    if (!campaign) {
      return null;
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt);
    expiresAt.setDate(expiresAt.getDate() + COUPON_VALIDITY_DAYS);

    const coupon = this.couponRepository.create({
      campaignId: campaign.id,
      funnelId,
      restaurantId: payment.restaurantId,
      customerId,
      funnelPaymentId,
      qrToken: randomUUID(),
      status: CouponStatus.ACTIVE,
      paymentStatus: CouponPaymentStatus.PAID,
      issuedAt,
      expiresAt,
    });

    try {
      return await this.couponRepository.save(coupon);
    } catch (err) {
      const raced = await this.couponRepository.findOne({
        where: { funnelPaymentId },
      });
      if (raced) {
        return raced;
      }
      this.logger.warn(`Failed to issue coupon for payment ${funnelPaymentId}`, err);
      return null;
    }
  }

  async findByPaymentId(funnelPaymentId: number): Promise<Coupon | null> {
    return this.couponRepository.findOne({
      where: { funnelPaymentId },
      relations: ['customer', 'campaign', 'funnelPayment'],
    });
  }

  async isPaymentConfirmed(coupon: Coupon): Promise<boolean> {
    if (coupon.paymentStatus !== CouponPaymentStatus.PAID) {
      return false;
    }
    if (!coupon.funnelPaymentId) {
      return false;
    }

    const payment =
      coupon.funnelPayment ??
      (await this.funnelPaymentRepository.findOne({
        where: { id: coupon.funnelPaymentId },
      }));

    return payment?.status === FunnelPaymentStatus.PAID;
  }

  async findByQrToken(qrToken: string): Promise<Coupon | null> {
    return this.couponRepository.findOne({
      where: { qrToken },
      relations: ['customer', 'campaign', 'funnelPayment'],
    });
  }

  /**
   * Keep coupon payment_status aligned with Stripe funnel payment lifecycle
   * (refunds, disputes) before preview/redeem decisions.
   */
  async syncPaymentStatusFromFunnelPayment(coupon: Coupon): Promise<Coupon> {
    if (!coupon.funnelPaymentId) {
      return coupon;
    }

    const payment =
      coupon.funnelPayment ??
      (await this.funnelPaymentRepository.findOne({
        where: { id: coupon.funnelPaymentId },
      }));

    if (!payment) {
      return coupon;
    }

    const mapped = this.mapFunnelPaymentToCouponStatus(payment.status);
    if (mapped !== coupon.paymentStatus) {
      await this.couponRepository.update(coupon.id, { paymentStatus: mapped });
      coupon.paymentStatus = mapped;
    }

    return coupon;
  }

  /** Sync all coupons tied to a funnel payment after webhook status change. */
  async syncCouponsForFunnelPayment(funnelPaymentId: number): Promise<void> {
    const payment = await this.funnelPaymentRepository.findOne({
      where: { id: funnelPaymentId },
    });
    if (!payment) {
      return;
    }

    const mapped = this.mapFunnelPaymentToCouponStatus(payment.status);
    await this.couponRepository.update(
      { funnelPaymentId },
      { paymentStatus: mapped },
    );
  }

  mapFunnelPaymentToCouponStatus(
    status: FunnelPaymentStatus,
  ): CouponPaymentStatus {
    switch (status) {
      case FunnelPaymentStatus.PAID:
        return CouponPaymentStatus.PAID;
      case FunnelPaymentStatus.PENDING:
        return CouponPaymentStatus.PENDING;
      case FunnelPaymentStatus.FAILED:
      case FunnelPaymentStatus.CANCELLED:
        return CouponPaymentStatus.FAILED;
      case FunnelPaymentStatus.REFUNDED:
      case FunnelPaymentStatus.PARTIALLY_REFUNDED:
        return CouponPaymentStatus.REFUNDED;
      case FunnelPaymentStatus.DISPUTED:
        return CouponPaymentStatus.DISPUTED;
      default:
        return CouponPaymentStatus.PENDING;
    }
  }

  /** Build QR payload and image for a coupon pass. */
  async buildQrPayload(coupon: Coupon): Promise<{
    couponId: number;
    token: string;
    qrDataUrl: string;
  }> {
    const payload = { couponId: coupon.id, token: coupon.qrToken };
    const qrDataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
      margin: 2,
      width: 280,
    });
    return { couponId: coupon.id, token: coupon.qrToken, qrDataUrl };
  }

  isExpired(coupon: Coupon): boolean {
    if (coupon.status === CouponStatus.EXPIRED) {
      return true;
    }
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      return true;
    }
    return false;
  }
}
