import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetaFunnelEvent } from '../../db/entities/meta-funnel-event.entity';
import { BusinessTrackingModule } from '../business-tracking/business-tracking.module';
import { FunnelMetaCapiService } from './funnel-meta-capi.service';
import { FunnelMetaTrackingController } from './funnel-meta-tracking.controller';
import { FUNNEL_META_CAPI_QUEUE } from './funnel-meta-tracking-queue.constants';
import { FunnelMetaTrackingQueueProcessor } from './funnel-meta-tracking-queue.processor';
import { FunnelMetaTrackingService } from './funnel-meta-tracking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetaFunnelEvent]),
    BusinessTrackingModule,
    BullModule.registerQueue({ name: FUNNEL_META_CAPI_QUEUE }),
  ],
  controllers: [FunnelMetaTrackingController],
  providers: [
    FunnelMetaTrackingService,
    FunnelMetaCapiService,
    FunnelMetaTrackingQueueProcessor,
  ],
  exports: [FunnelMetaTrackingService, FunnelMetaCapiService],
})
export class FunnelMetaTrackingModule {}
