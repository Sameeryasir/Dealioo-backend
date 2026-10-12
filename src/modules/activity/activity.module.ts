import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityEvent } from '../../db/entities/activity-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Business } from '../../db/entities/business.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { AuthModule } from '../auth/auth.module';
import { CustomerActivityModule } from '../customer-activity/customer-activity.module';
import { SidebarUnreadModule } from '../sidebar-unread/sidebar-unread.module';
// --- SWC circular import fix ---
// Lazy-resolve RedemptionModule so Activity ↔ Redemption does not TDZ under SWC.
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';
import { ActivityStatsCacheService } from './activity-stats-cache.service';
import { ACTIVITY_STATS_QUEUE } from './activity-stats-queue.constants';
import { ActivityStatsQueueProcessor } from './activity-stats-queue.processor';
import { ActivityStatsQueueService } from './activity-stats-queue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityEvent,
      Business,
      Campaign,
      Customer,
      FunnelPayment,
    ]),
    BullModule.registerQueue({ name: ACTIVITY_STATS_QUEUE }),
    AuthModule,
    CustomerActivityModule,
    SidebarUnreadModule,
    forwardRef(() => require('../redemption/redemption.module').RedemptionModule),
  ],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    ActivityStatsCacheService,
    ActivityStatsQueueService,
    ActivityStatsQueueProcessor,
  ],
  exports: [ActivityService],
})
export class ActivityModule {}
