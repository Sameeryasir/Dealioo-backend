import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { CustomerOnboarding } from '../../db/entities/customer-onboarding.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { OnboardingTask } from '../../db/entities/onboarding-task.entity';
import { PlatformAdminAuditLog } from '../../db/entities/platform-admin-audit-log.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { SuperAdminGuard } from '../platform-admin/super-admin.guard';
import { CustomerOnboardingController } from './customer-onboarding.controller';
import { CustomerOnboardingService } from './customer-onboarding.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      MeetingRequest,
      CustomerOnboarding,
      OnboardingTask,
      User,
      Role,
      Business,
      BusinessMember,
      PlatformAdminAuditLog,
    ]),
  ],
  controllers: [CustomerOnboardingController],
  providers: [CustomerOnboardingService, SuperAdminGuard],
  exports: [CustomerOnboardingService],
})
export class CustomerOnboardingModule {}
