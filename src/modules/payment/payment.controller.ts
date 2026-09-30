import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { BusinessAccessService } from '../business-access/business-access.service';
import { campaignOrdersPermissionKeys } from '../member/member.constants';
import { PaymentService } from './payment.service';
import { CheckoutResumeService } from './checkout-resume.service';
import { CreatePaymentIntentDto } from './paymentDto/create-payment-intent.dto';
import { CreateCheckoutSessionDto } from './paymentDto/create-checkout-session.dto';
import { GetFunnelOrdersQueryDto } from './paymentDto/get-funnel-orders-query.dto';

type RawBodyRequest = Request & { rawBody?: Buffer };
type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly checkoutResumeService: CheckoutResumeService,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('session')
  @HttpCode(200)
  createPaymentSession(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentService.createPaymentSession(dto);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('intent')
  @HttpCode(200)
  createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentService.createPaymentIntent(dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('checkout/session')
  @HttpCode(200)
  createCheckoutSession(@Body() dto: CreateCheckoutSessionDto) {
    return this.checkoutResumeService.createSession({
      customerId: dto.customerId,
      funnelId: dto.funnelId,
      businessId: dto.businessId,
      campaignId: dto.campaignId ?? null,
    });
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('checkout/resume')
  resumeCheckout(@Query('token') token: string) {
    return this.checkoutResumeService.resolveSession(token);
  }

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  handleStripeWebhook(
    @Req() req: RawBodyRequest,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.paymentService.handleStripeWebhook(req.rawBody, signature);
  }

  @Get('funnel/:funnelId/orders')
  @UseGuards(AuthGuard('jwt'))
  async getFunnelOrders(
    @Param('funnelId', ParseIntPipe) funnelId: number,
    @Query() query: GetFunnelOrdersQueryDto,
    @Req() req: AuthRequest,
  ) {
    const businessId =
      await this.paymentService.getFunnelBusinessId(funnelId);
    await this.businessAccessService.assertAnyPermission(
      req.user,
      businessId,
      campaignOrdersPermissionKeys(),
      'You do not have permission to view campaign orders.',
    );
    return this.paymentService.getFunnelOrders(
      funnelId,
      query.page ?? 1,
      query.limit ?? 10,
    );
  }

  @Get('funnel/:funnelId')
  @UseGuards(AuthGuard('jwt'))
  async getPaidFunnelPayments(
    @Param('funnelId', ParseIntPipe) funnelId: number,
    @Req() req: AuthRequest,
  ) {
    const businessId =
      await this.paymentService.getFunnelBusinessId(funnelId);
    await this.businessAccessService.assertAnyPermission(
      req.user,
      businessId,
      campaignOrdersPermissionKeys(),
      'You do not have permission to view campaign orders.',
    );
    return this.paymentService.getPaidFunnelPayments(funnelId);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':paymentId/status')
  getPaymentStatus(
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Query('checkoutToken') checkoutToken?: string,
  ) {
    return this.paymentService.getPaymentStatus(paymentId, checkoutToken);
  }
}
