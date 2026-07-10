import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { StripeWebhookEvent } from '../../db/entities/stripe-webhook-event.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import { Customer } from '../../db/entities/customer.entity';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { AuthModule } from '../auth/auth.module';
import { ActivityModule } from '../activity/activity.module';
import { FunnelEventModule } from '../funnel-event/funnel-event.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { StripeModule } from '../stripe/stripe.module';
import { FeeService } from './fee.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentWebhookHandler } from './payment-webhook.handler';
import { StripeWebhookService } from './stripe-webhook.service';
import { CheckoutResumeService } from './checkout-resume.service';
import { UserSubscriptionsModule } from '../user-subscriptions/user-subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Business,
      Funnel,
      FunnelPayment,
      StripeWebhookEvent,
      Customer,
      CheckoutAccessToken,
    ]),
    StripeModule,
    AuthModule,
    UserSubscriptionsModule,
    forwardRef(() => RedemptionModule),
    forwardRef(() => FunnelEventModule),
    ActivityModule,
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    FeeService,
    StripeWebhookService,
    PaymentWebhookHandler,
    CheckoutResumeService,
  ],
  exports: [PaymentService, CheckoutResumeService],
})
export class PaymentModule {}
