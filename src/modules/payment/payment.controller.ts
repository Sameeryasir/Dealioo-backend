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
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PaymentService } from './payment.service';
import { CheckoutResumeService } from './checkout-resume.service';
import { CreatePaymentIntentDto } from './paymentDto/create-payment-intent.dto';
import { CreateCheckoutSessionDto } from './paymentDto/create-checkout-session.dto';

type RawBodyRequest = Request & { rawBody?: Buffer };

@SkipThrottle()
@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly checkoutResumeService: CheckoutResumeService,
  ) {}

  @Post('intent')
  @HttpCode(200)
  createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentService.createPaymentIntent(dto);
  }

  /** Create a server checkout session after funnel signup. */
  @Post('checkout/session')
  @HttpCode(200)
  createCheckoutSession(@Body() dto: CreateCheckoutSessionDto) {
    return this.checkoutResumeService.createSession({
      customerId: dto.customerId,
      funnelId: dto.funnelId,
      restaurantId: dto.restaurantId,
      campaignId: dto.campaignId ?? null,
    });
  }

  /** Resolve checkout token (signup redirect or payment reminder email). */
  @Get('checkout/resume')
  resumeCheckout(@Query('token') token: string) {
    return this.checkoutResumeService.resolveSession(token);
  }

  @Post('webhook')
  @HttpCode(200)
  handleStripeWebhook(
    @Req() req: RawBodyRequest,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.paymentService.handleStripeWebhook(req.rawBody, signature);
  }

  @Get('funnel/:funnelId')
  @UseGuards(AuthGuard('jwt'))
  getPaidFunnelPayments(
    @Param('funnelId', ParseIntPipe) funnelId: number,
  ) {
    return this.paymentService.getPaidFunnelPayments(funnelId);
  }

  @Get(':paymentId/status')
  getPaymentStatus(@Param('paymentId', ParseIntPipe) paymentId: number) {
    return this.paymentService.getPaymentStatus(paymentId);
  }
}
