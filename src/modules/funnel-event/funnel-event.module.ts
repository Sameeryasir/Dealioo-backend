import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
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
    ]),
    AutomationModule,
    RedemptionModule,
  ],
  controllers: [FunnelEventController],
  providers: [FunnelEventService, FunnelAnalyticsService],
  exports: [FunnelEventService, FunnelAnalyticsService],
})
export class FunnelEventModule {}
