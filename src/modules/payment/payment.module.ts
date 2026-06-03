import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { StripeWebhookEvent } from '../../db/entities/stripe-webhook-event.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';
import { StripeModule } from '../stripe/stripe.module';
import { FeeService } from './fee.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentWebhookHandler } from './payment-webhook.handler';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Restaurant,
      Funnel,
      FunnelPayment,
      StripeWebhookEvent,
    ]),
    StripeModule,
    AuthModule,
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    FeeService,
    StripeWebhookService,
    PaymentWebhookHandler,
  ],
})
export class PaymentModule {}
