import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityEvent } from '../../db/entities/activity-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Business } from '../../db/entities/business.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomerActivityModule } from '../customer-activity/customer-activity.module';
// --- SWC circular import fix ---
// Lazy-resolve RedemptionModule so Activity ↔ Redemption does not TDZ under SWC.
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityEvent,
      Business,
      Campaign,
      Customer,
      FunnelPayment,
    ]),
    AuthModule,
    CustomerActivityModule,
    forwardRef(() => require('../redemption/redemption.module').RedemptionModule),
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
