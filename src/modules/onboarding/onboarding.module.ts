import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { PlanFitAssessment } from '../../db/entities/plan-fit-assessment.entity';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscriptionsModule } from '../user-subscriptions/user-subscriptions.module';
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
    ]),
    forwardRef(() => UserSubscriptionsModule),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService, PlanFitRecommendationService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
