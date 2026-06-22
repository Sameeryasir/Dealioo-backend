import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { GoogleAdsIntegrationAuditService } from './google-ads-integration-audit.service';
import { GoogleAdsTokenService } from './google-ads-token.service';
import { GoogleAdsController } from './google-ads.controller';
import { GoogleAdsService } from './google-ads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Restaurant, IntegrationAuditLog]),
    RestaurantModule,
  ],
  controllers: [GoogleAdsController],
  providers: [
    GoogleAdsService,
    GoogleAdsIntegrationAuditService,
    GoogleAdsTokenService,
  ],
  exports: [GoogleAdsService, GoogleAdsTokenService],
})
export class GoogleAdsModule {}
