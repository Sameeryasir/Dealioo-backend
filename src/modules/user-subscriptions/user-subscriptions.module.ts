import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
// --- SWC circular import fix ---
// Avoid value-importing OnboardingModule (live binding TDZ); resolve via require in forwardRef.
import { StripeModule } from '../stripe/stripe.module';
import { UserSubscriptionsController } from './user-subscriptions.controller';
import { UserSubscriptionsService } from './user-subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSubscription, SubscriptionPlan, User]),
    StripeModule,
    forwardRef(() => require('../onboarding/onboarding.module').OnboardingModule),
  ],
  controllers: [UserSubscriptionsController],
  providers: [UserSubscriptionsService],
  exports: [UserSubscriptionsService],
})
export class UserSubscriptionsModule {}
