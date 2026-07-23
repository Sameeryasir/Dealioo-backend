import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { CustomerVisitCampaign } from '../../db/entities/customer-visit-campaign.entity';
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
import { CustomerJourneyModule } from '../customer-journey/customer-journey.module';
import { CustomerModule } from '../customer/customer.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { FunnelEventController } from './funnel-event.controller';
import { FunnelEventService } from './funnel-event.service';

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
      CheckoutAccessToken,
      Business,
      ScannerPurchaseRequest,
    ]),
    forwardRef(() => AutomationModule),
    forwardRef(() => RedemptionModule),
    ActivityModule,
    BusinessHistoryModule,
    CustomerJourneyModule,
    CustomerModule,
  ],
  controllers: [FunnelEventController],
  providers: [FunnelEventService, FunnelAnalyticsService],
  exports: [FunnelEventService, FunnelAnalyticsService],
})
export class FunnelEventModule {}
