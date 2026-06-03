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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import { CreatePaymentIntentDto } from './paymentDto/create-payment-intent.dto';

@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post('intent')
  @HttpCode(200)
  createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentService.createPaymentIntent(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId')
  getPaidFunnelPayments(@Param('funnelId', ParseIntPipe) funnelId: number) {
    return this.paymentService.getPaidFunnelPayments(funnelId);
  }

  @Get(':paymentId/status')
  getPaymentStatus(@Param('paymentId', ParseIntPipe) paymentId: number) {
    return this.paymentService.getPaymentStatus(paymentId);
  }

  @SkipThrottle()
  @Get('webhook/health')
  webhookHealth() {
    const secretConfigured = Boolean(
      process.env.STRIPE_WEBHOOK_SECRET?.trim(),
    );
    return {
      ok: secretConfigured,
      endpoint: 'POST /payment/webhook',
      stripeWebhookSecretConfigured: secretConfigured,
      hint: secretConfigured
        ? 'Use stripe listen --forward-to localhost:4001/payment/webhook for local testing.'
        : 'Set STRIPE_WEBHOOK_SECRET in .env (from stripe listen or Stripe Dashboard signing secret).',
    };
  }

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  handleStripeWebhook(
    @Req()
    req: import('express').Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    const rawBodyBytes = req.rawBody?.length ?? 0;
    this.logger.log(
      JSON.stringify({
        scope: 'stripe_webhook_http',
        path: '/payment/webhook',
        method: 'POST',
        rawBodyBytes,
        hasStripeSignature: Boolean(signature),
      }),
    );
    return this.paymentService.handleStripeWebhook(req.rawBody, signature);
  }
}
