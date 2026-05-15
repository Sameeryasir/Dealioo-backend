import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
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
