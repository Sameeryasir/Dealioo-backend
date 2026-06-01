import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { AutomationModule } from '../automation/automation.module';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { FunnelEventController } from './funnel-event.controller';
import { FunnelEventService } from './funnel-event.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FunnelEvent,
      FunnelAnalyticsEvent,
      Funnel,
      FunnelPayment,
      Customer,
    ]),
    AutomationModule,
  ],
  controllers: [FunnelEventController],
  providers: [FunnelEventService, FunnelAnalyticsService],
  exports: [FunnelEventService, FunnelAnalyticsService],
})
export class FunnelEventModule {}
