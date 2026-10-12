import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { CustomerVisitCampaign } from '../../db/entities/customer-visit-campaign.entity';
import { VisitAddonItem } from '../../db/entities/visit-addon-item.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Order } from '../../db/entities/order.entity';
import { ScannerPurchaseRequest } from '../../db/entities/scanner-purchase-request.entity';
import { Business } from '../../db/entities/business.entity';
import { ActivityModule } from '../activity/activity.module';
import { AutomationModule } from '../automation/automation.module';
import { BusinessHistoryModule } from '../business-history/business-history.module';
import { CustomerActivityModule } from '../customer-activity/customer-activity.module';
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { CustomerModule } from '../customer/customer.module';
import { PaymentModule } from '../payment/payment.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { FunnelEventController } from './funnel-event.controller';
import { FunnelEventService } from './funnel-event.service';
import { FunnelStatsCacheService } from './funnel-stats-cache.service';
import { FUNNEL_STATS_QUEUE } from './funnel-stats-queue.constants';
import { FunnelStatsQueueProcessor } from './funnel-stats-queue.processor';
import { FunnelStatsQueueService } from './funnel-stats-queue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FunnelEvent,
      FunnelAnalyticsEvent,
      Campaign,
      Funnel,
      FunnelPayment,
      Order,
      Customer,
      CustomerVisit,
      CustomerVisitCampaign,
      VisitAddonItem,
      CheckoutAccessToken,
      Business,
      ScannerPurchaseRequest,
    ]),
    BullModule.registerQueue({ name: FUNNEL_STATS_QUEUE }),
    forwardRef(() => AutomationModule),
    forwardRef(() => RedemptionModule),
    forwardRef(() => PaymentModule),
    ActivityModule,
    BusinessHistoryModule,
    CustomerActivityModule,
    CustomerJourneyModule,
    CustomerModule,
  ],
  controllers: [FunnelEventController],
  providers: [
    FunnelEventService,
    FunnelAnalyticsService,
    FunnelStatsCacheService,
    FunnelStatsQueueService,
    FunnelStatsQueueProcessor,
  ],
  exports: [FunnelEventService, FunnelAnalyticsService],
})
export class FunnelEventModule {}
