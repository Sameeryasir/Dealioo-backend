import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { FunnelEventController } from './funnel-event.controller';
import { FunnelEventService } from './funnel-event.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FunnelEvent, Funnel, FunnelPayment, Customer]),
  ],
  controllers: [FunnelEventController],
  providers: [FunnelEventService],
  exports: [FunnelEventService],
})
export class FunnelEventModule {}
