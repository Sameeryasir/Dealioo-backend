import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { Business } from '../../db/entities/business.entity';
import { BusinessModule } from '../business/business.module';
import { GoogleAdsIntegrationAuditService } from './google-ads-integration-audit.service';
import { GoogleAdsTokenService } from './google-ads-token.service';
import { GoogleAdsController } from './google-ads.controller';
import { GoogleAdsService } from './google-ads.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Business, IntegrationAuditLog]),
    BusinessModule,
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
