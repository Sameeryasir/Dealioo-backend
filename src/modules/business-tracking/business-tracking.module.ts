import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessTracking } from '../../db/entities/business-tracking.entity';
import { AuthModule } from '../auth/auth.module';
import { BusinessAccessModule } from '../business-access/business-access.module';
import { BusinessTrackingController } from './business-tracking.controller';
import { BusinessTrackingService } from './business-tracking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessTracking]),
    AuthModule,
    BusinessAccessModule,
  ],
  controllers: [BusinessTrackingController],
  providers: [BusinessTrackingService],
  exports: [BusinessTrackingService],
})
export class BusinessTrackingModule {}
