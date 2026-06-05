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
import type { Request } from 'express';
import { JwtAccessPayload } from '../auth/jwt/jwt-access-payload.interface';
import { CouponService } from './coupon.service';
import { ScanQrDto } from './dto/scan-qr.dto';
import { RedemptionService } from './redemption.service';

type AuthRequest = Request & { user: JwtAccessPayload };

@Controller('redemption')
export class RedemptionController {
  constructor(
    private readonly redemptionService: RedemptionService,
    private readonly couponService: CouponService,
  ) {}

  /** Staff previews a customer QR before confirming redemption. */
  @UseGuards(AuthGuard('jwt'))
  @Post('scan/:restaurantId/preview')
  @HttpCode(200)
  previewScanForRestaurant(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Body() dto: ScanQrDto,
  ) {
    return this.redemptionService.previewScan(dto.qrToken, restaurantId);
  }

  /** Staff confirms redemption after preview. */
  @UseGuards(AuthGuard('jwt'))
  @Post('scan/:restaurantId')
  @HttpCode(200)
  scanForRestaurant(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Body() dto: ScanQrDto,
    @Req() req: AuthRequest,
  ) {
    return this.redemptionService.scan(
      dto.qrToken,
      restaurantId,
      req.user.sub,
      dto.deviceInfo,
      dto.couponIds,
      dto.orderSubtotal,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/guests/:customerId/profile')
  getGuestProfile(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
  ) {
    return this.redemptionService.getGuestProfile(customerId, restaurantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/stats')
  getStats(@Param('restaurantId', ParseIntPipe) restaurantId: number) {
    return this.redemptionService.getRestaurantStats(restaurantId);
  }

  /** Guest fetches their coupon + QR after payment (public). */
  @Get('coupon/payment/:funnelPaymentId')
  async getCouponByPayment(
    @Param('funnelPaymentId', ParseIntPipe) funnelPaymentId: number,
  ) {
    const coupon = await this.couponService.findByPaymentId(funnelPaymentId);
    if (!coupon) {
      throw new NotFoundException('Coupon not found for this payment');
    }
    const paymentConfirmed =
      await this.couponService.isPaymentConfirmed(coupon);
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
      qr,
    };
  }
}
