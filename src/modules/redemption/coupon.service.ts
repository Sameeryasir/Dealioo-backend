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

  /** Issue one coupon per paid funnel payment (idempotent). */
  async issueFromPayment(
    funnelPaymentId: number,
    funnelId: number,
    customerId: number,
  ): Promise<Coupon | null> {
    const existing = await this.couponRepository.findOne({
      where: { funnelPaymentId },
    });
    if (existing) {
      return existing;
    }

    const payment = await this.funnelPaymentRepository.findOne({
      where: { id: funnelPaymentId, funnelId },
    });
    if (!payment || payment.status !== FunnelPaymentStatus.PAID) {
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
      // Race: another request may have created the coupon first.
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
      relations: ['customer', 'campaign'],
    });
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
