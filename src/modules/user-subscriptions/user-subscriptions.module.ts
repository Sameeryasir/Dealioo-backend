import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { StripeModule } from '../stripe/stripe.module';
import { UserSubscriptionsController } from './user-subscriptions.controller';
import { UserSubscriptionsService } from './user-subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSubscription, SubscriptionPlan, User]),
    StripeModule,
    forwardRef(() => OnboardingModule),
  ],
  controllers: [UserSubscriptionsController],
  providers: [UserSubscriptionsService],
  exports: [UserSubscriptionsService],
})
export class UserSubscriptionsModule {}
