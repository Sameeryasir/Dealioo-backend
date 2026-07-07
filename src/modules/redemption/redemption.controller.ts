import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { requireScannerRole } from '../../utils/require-scanner-role';
import { CouponService } from './coupon.service';
import { ScanQrDto } from './dto/scan-qr.dto';
import { RedemptionService } from './redemption.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

function resolveClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip || req.socket?.remoteAddress || undefined;
}

@Controller('redemption')
export class RedemptionController {
  constructor(
    private readonly redemptionService: RedemptionService,
    private readonly couponService: CouponService,
  ) {}

  /** Staff previews a customer QR before confirming redemption (read-only). */
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('scan/:restaurantId/preview')
  @HttpCode(200)
  async previewScanForRestaurant(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Body() dto: ScanQrDto,
    @Req() req: AuthRequest,
  ) {
    requireScannerRole(req.user);
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.redemptionService.previewScan(dto.qrToken, restaurantId, {
      scannedBy: req.user.id,
      deviceInfo: dto.deviceInfo,
      ipAddress: resolveClientIp(req),
    });
  }

  /** Staff confirms redemption after preview — all checks repeated server-side. */
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('scan/:restaurantId')
  @HttpCode(200)
  async scanForRestaurant(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Body() dto: ScanQrDto,
    @Req() req: AuthRequest,
  ) {
    requireScannerRole(req.user);
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.redemptionService.scan(
      dto.qrToken,
      restaurantId,
      {
        scannedBy: req.user.id,
        deviceInfo: dto.deviceInfo,
        ipAddress: resolveClientIp(req),
        idempotencyKey: dto.idempotencyKey,
      },
      dto.couponIds,
      dto.orderSubtotal,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/guests/:customerId/profile')
  async getGuestProfile(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Req() req: AuthRequest,
  ) {
    requireScannerRole(req.user);
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );
    return this.redemptionService.getGuestProfile(customerId, restaurantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/stats')
  async getStats(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Req() req: AuthRequest,
  ) {
    requireScannerRole(req.user);
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );
    return this.redemptionService.getRestaurantStats(restaurantId);
  }

  /** Guest fetches their signup pass before checkout (public). */
  @Get('coupon/customer/:customerId/funnel/:funnelId')
  async getCouponByCustomerAndFunnel(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Param('funnelId', ParseIntPipe) funnelId: number,
  ) {
    const coupon = await this.couponService.findByCustomerAndFunnel(
      customerId,
      funnelId,
    );
    if (!coupon) {
      throw new NotFoundException('Pass not found for this guest');
    }
    return this.buildGuestCouponResponse(coupon);
  }

  /** Guest fetches their coupon + QR by payment session (public). */
  @Get('coupon/payment/:funnelPaymentId')
  async getCouponByPayment(
    @Param('funnelPaymentId', ParseIntPipe) funnelPaymentId: number,
  ) {
    const coupon =
      (await this.couponService.findByPaymentId(funnelPaymentId)) ??
      (await this.couponService.findLatestByPaymentId(funnelPaymentId));
    if (!coupon) {
      throw new NotFoundException('Coupon not found for this payment');
    }
    return this.buildGuestCouponResponse(coupon);
  }

  private async buildGuestCouponResponse(coupon: Awaited<
    ReturnType<CouponService['findByPaymentId']>
  >) {
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    await this.couponService.syncPaymentStatusFromFunnelPayment(coupon);
    const paymentConfirmed =
      await this.couponService.isPaymentConfirmed(coupon);
    const passDisplay = this.couponService.resolveGuestPassDisplay(coupon);

    if (!passDisplay.passAvailable) {
      return {
        id: coupon.id,
        status: coupon.status,
        paymentStatus: coupon.paymentStatus,
        paymentConfirmed,
        issuedAt: coupon.issuedAt,
        expiresAt: coupon.expiresAt,
        campaignName: coupon.campaign?.campaignName ?? null,
        customerName: coupon.customer?.name ?? null,
        passAvailable: false,
        passUnavailableReason: passDisplay.passUnavailableReason,
        passMessage: passDisplay.passMessage,
        qr: null,
      };
    }

    const qr = await this.couponService.buildQrPayload(coupon);
    return {
      id: coupon.id,
      status: coupon.status,
      paymentStatus: coupon.paymentStatus,
      paymentConfirmed,
      issuedAt: coupon.issuedAt,
      expiresAt: coupon.expiresAt,
      campaignName: coupon.campaign?.campaignName ?? null,
      customerName: coupon.customer?.name ?? null,
      passAvailable: true,
      passUnavailableReason: null,
      passMessage: null,
      qr,
    };
  }
}
