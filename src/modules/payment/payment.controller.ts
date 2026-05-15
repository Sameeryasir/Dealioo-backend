import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import { CreatePaymentIntentDto } from './paymentDto/create-payment-intent.dto';

/**
 * Checkout HTTP surface for funnel payments (Stripe Connect).
 *
 * End-to-end flow (after `POST /payment/intent` returns `clientSecret`):
 *
 *   User clicks Complete Payment
 *        |
 *        v
 *   Frontend: stripe.confirmPayment(...)
 *        |
 *        v
 *   Request goes to Stripe (card validation, auth, 3DS, fraud checks, etc.)
 *        |
 *        v
 *   Stripe decides outcome, then Stripe's servers POST signed events to:
 *        POST /payment/webhook
 *        |
 *        v
 *   This backend verifies the signature and updates `funnel_payment` status.
 *
 * Do not call `/payment/webhook` from the browser; only Stripe calls it.
 */
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /** Step 1: create PaymentIntent + DB row; frontend uses returned `clientSecret` with Stripe.js. */
  @Post('intent')
  @HttpCode(200)
  createPaymentIntent(@Body() dto: CreatePaymentIntentDto) {
    return this.paymentService.createPaymentIntent(dto);
  }

  /** Stripe → this URL only. Register in Dashboard; set `STRIPE_WEBHOOK_SECRET` from the endpoint signing secret. */
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  handleStripeWebhook(
    @Req()
    req: import('express').Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.paymentService.handleStripeWebhook(req.rawBody, signature);
  }
}
