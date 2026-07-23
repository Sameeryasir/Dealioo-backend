import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Customer } from '../../db/entities/customer.entity';
import { Coupon } from '../../db/entities/coupon.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { CustomerVisitCampaign } from '../../db/entities/customer-visit-campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Order } from '../../db/entities/order.entity';
import { RedemptionLog } from '../../db/entities/redemption-log.entity';
import { Business } from '../../db/entities/business.entity';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { AutomationModule } from '../automation/automation.module';
import { BusinessHistoryModule } from '../business-history/business-history.module';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { CouponService } from './coupon.service';
import { RedemptionController } from './redemption.controller';
import { RedemptionValidationService } from './redemption-validation.service';
import { RedemptionService } from './redemption.service';
import { SIGNUP_QR_EMAIL_QUEUE } from './signup-qr-email.constants';
import { SignupQrEmailProcessor } from './signup-qr-email.processor';
import { SignupQrEmailService } from './signup-qr-email.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: SIGNUP_QR_EMAIL_QUEUE }),
    TypeOrmModule.forFeature([
      Coupon,
      RedemptionLog,
      CustomerVisit,
      CustomerVisitCampaign,
      Customer,
      Campaign,
      Funnel,
      FunnelPayment,
      FunnelEvent,
      Business,
      Order,
    ]),
    AuthModule,
    forwardRef(() => ActivityModule),
    forwardRef(() => AutomationModule),
    BusinessHistoryModule,
    CustomerJourneyModule,
  ],
  controllers: [RedemptionController],
  providers: [
    CouponService,
    RedemptionValidationService,
    RedemptionService,
    SignupQrEmailService,
    SignupQrEmailProcessor,
  ],
  exports: [CouponService, SignupQrEmailService, RedemptionService],
})
export class RedemptionModule {}
