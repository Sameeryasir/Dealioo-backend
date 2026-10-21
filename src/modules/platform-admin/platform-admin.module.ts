import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotification } from '../../db/entities/admin-notification.entity';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessTwilioIntegration } from '../../db/entities/business-twilio-integration.entity';
import { CustomerOnboarding } from '../../db/entities/customer-onboarding.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { PlatformAdminAuditLog } from '../../db/entities/platform-admin-audit-log.entity';
import { PlatformTwilioPhoneNumber } from '../../db/entities/platform-twilio-phone-number.entity';
import { Role } from '../../db/entities/role.entity';
import { SubscriptionPlan } from '../../db/entities/subscription-plan.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { AuthModule } from '../auth/auth.module';
import { SmsModule } from '../sms/sms.module';
import { StripeModule } from '../stripe/stripe.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { SuperAdminGuard } from './super-admin.guard';

@Module({
  imports: [
    AuthModule,
    StripeModule,
    SmsModule,
    TypeOrmModule.forFeature([
      User,
      Role,
      Business,
      BusinessMember,
      BusinessTwilioIntegration,
      PlatformTwilioPhoneNumber,
      UserSubscription,
      AdminNotification,
      MeetingRequest,
      CustomerOnboarding,
      PlatformAdminAuditLog,
      SubscriptionPlan,
    ]),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, SuperAdminGuard],
})
export class PlatformAdminModule {}
