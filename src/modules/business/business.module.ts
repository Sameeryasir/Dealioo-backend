import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessOnboardingDraft } from '../../db/entities/business-onboarding-draft.entity';
import { OnboardingEvent } from '../../db/entities/onboarding-event.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { AuthModule } from '../auth/auth.module';
import { BusinessHistoryModule } from '../business-history/business-history.module';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';
import { BUSINESS_ONBOARDING_QUEUE } from './business-onboarding-queue.constants';
import { BusinessOnboardingQueueProcessor } from './business-onboarding-queue.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Business,
      User,
      UserSubscription,
      BusinessOnboardingDraft,
      OnboardingEvent,
    ]),
    AuthModule,
    BusinessHistoryModule,
    BullModule.registerQueue({ name: BUSINESS_ONBOARDING_QUEUE }),
  ],
  controllers: [BusinessController],
  providers: [BusinessService, BusinessOnboardingQueueProcessor],
  exports: [BusinessService],
})
export class BusinessModule {}
