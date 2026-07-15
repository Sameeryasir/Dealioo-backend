import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { StripeModule } from '../stripe/stripe.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserSubscription, SubscriptionPlan]),
    StripeModule,
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
