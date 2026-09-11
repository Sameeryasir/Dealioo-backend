import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { GoogleFunnelEvent } from '../../db/entities/google-funnel-event.entity';
import { BusinessTrackingModule } from '../business-tracking/business-tracking.module';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { FunnelGoogleConversionUploadService } from './funnel-google-conversion-upload.service';
import { GoogleFunnelTrackingController } from './google-funnel-tracking.controller';
import { FUNNEL_GOOGLE_UPLOAD_QUEUE } from './google-funnel-tracking-queue.constants';
import { GoogleFunnelTrackingQueueProcessor } from './google-funnel-tracking-queue.processor';
import { GoogleFunnelTrackingService } from './google-funnel-tracking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([GoogleFunnelEvent, Business]),
    BusinessTrackingModule,
    GoogleAdsModule,
    BullModule.registerQueue({ name: FUNNEL_GOOGLE_UPLOAD_QUEUE }),
  ],
  controllers: [GoogleFunnelTrackingController],
  providers: [
    GoogleFunnelTrackingService,
    FunnelGoogleConversionUploadService,
    GoogleFunnelTrackingQueueProcessor,
  ],
  exports: [GoogleFunnelTrackingService],
})
export class GoogleFunnelTrackingModule {}
