import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessCustomer } from '../../db/entities/business-customer.entity';
import { BusinessInvitation } from '../../db/entities/business-invitation.entity';
import { BusinessOnboardingDraft } from '../../db/entities/business-onboarding-draft.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { OnboardingEvent } from '../../db/entities/onboarding-event.entity';
import { PlanFitAssessment } from '../../db/entities/plan-fit-assessment.entity';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
// --- SWC circular import fix ---
// Avoid value-importing UserSubscriptionsModule (live binding TDZ); resolve via require in forwardRef.
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { PlanFitRecommendationService } from './plan-fit/plan-fit-recommendation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Business,
      PlanFitAssessment,
      SubscriptionPlan,
      BusinessOnboardingDraft,
      OnboardingEvent,
      BusinessInvitation,
      Campaign,
      BusinessCustomer,
    ]),
    forwardRef(
      () =>
        require('../user-subscriptions/user-subscriptions.module')
          .UserSubscriptionsModule,
    ),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService, PlanFitRecommendationService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
