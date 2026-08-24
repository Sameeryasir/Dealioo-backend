import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleFunnelEvent } from '../../db/entities/google-funnel-event.entity';
import { BusinessTrackingModule } from '../business-tracking/business-tracking.module';
import { GoogleFunnelTrackingController } from './google-funnel-tracking.controller';
import { GoogleFunnelTrackingService } from './google-funnel-tracking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([GoogleFunnelEvent]),
    BusinessTrackingModule,
  ],
  controllers: [GoogleFunnelTrackingController],
  providers: [GoogleFunnelTrackingService],
  exports: [GoogleFunnelTrackingService],
})
export class GoogleFunnelTrackingModule {}
