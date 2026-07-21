import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Coupon } from '../../db/entities/coupon.entity';
import { CustomerJourneyEvent } from '../../db/entities/customer-journey-event.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { CustomerJourneyService } from './customer-journey.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerJourneyEvent,
      FunnelEvent,
      CustomerVisit,
      Funnel,
      Campaign,
      Coupon,
    ]),
  ],
  providers: [CustomerJourneyService],
  exports: [CustomerJourneyService],
})
export class CustomerJourneyModule {}
