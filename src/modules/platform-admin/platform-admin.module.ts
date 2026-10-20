import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotification } from '../../db/entities/admin-notification.entity';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { CustomerOnboarding } from '../../db/entities/customer-onboarding.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { PlatformAdminAuditLog } from '../../db/entities/platform-admin-audit-log.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { SuperAdminGuard } from './super-admin.guard';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      User,
      Role,
      Business,
      BusinessMember,
      UserSubscription,
      AdminNotification,
      MeetingRequest,
      CustomerOnboarding,
      PlatformAdminAuditLog,
    ]),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, SuperAdminGuard],
})
export class PlatformAdminModule {}
