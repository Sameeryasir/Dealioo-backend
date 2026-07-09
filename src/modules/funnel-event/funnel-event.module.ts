import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Business } from '../../db/entities/business.entity';
import { ActivityModule } from '../activity/activity.module';
import { AutomationModule } from '../automation/automation.module';
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
      Customer,
      CustomerVisit,
      CheckoutAccessToken,
      Business,
    ]),
    forwardRef(() => AutomationModule),
    forwardRef(() => RedemptionModule),
    ActivityModule,
  ],
  controllers: [FunnelEventController],
  providers: [FunnelEventService, FunnelAnalyticsService],
  exports: [FunnelEventService, FunnelAnalyticsService],
})
export class FunnelEventModule {}
