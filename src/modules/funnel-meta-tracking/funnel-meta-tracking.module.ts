import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetaFunnelEvent } from '../../db/entities/meta-funnel-event.entity';
import { BusinessTrackingModule } from '../business-tracking/business-tracking.module';
import { FunnelMetaTrackingController } from './funnel-meta-tracking.controller';
import { FunnelMetaTrackingService } from './funnel-meta-tracking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetaFunnelEvent]),
    BusinessTrackingModule,
  ],
  controllers: [FunnelMetaTrackingController],
  providers: [FunnelMetaTrackingService],
  exports: [FunnelMetaTrackingService],
})
export class FunnelMetaTrackingModule {}
