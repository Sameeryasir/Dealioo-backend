import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { Business } from '../../db/entities/business.entity';
import { GoogleCampaignDraft } from '../../db/entities/google-campaign-draft.entity';
import { BusinessModule } from '../business/business.module';
import { GoogleAdsIntegrationAuditService } from './google-ads-integration-audit.service';
import { GoogleAdsTokenService } from './google-ads-token.service';
import { GoogleAdsController } from './google-ads.controller';
import { GoogleAdsService } from './google-ads.service';
import { GoogleCampaignDraftService } from './google-campaign-draft.service';
import { GOOGLE_PUBLISH_QUEUE } from './google-publish-queue.constants';
import { GooglePublishQueueProcessor } from './google-publish-queue.processor';
import { GooglePublishService } from './google-publish.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Business,
      IntegrationAuditLog,
      GoogleCampaignDraft,
    ]),
    BullModule.registerQueue({ name: GOOGLE_PUBLISH_QUEUE }),
    BusinessModule,
  ],
  controllers: [GoogleAdsController],
  providers: [
    GoogleAdsService,
    GoogleAdsIntegrationAuditService,
    GoogleAdsTokenService,
    GoogleCampaignDraftService,
    GooglePublishService,
    GooglePublishQueueProcessor,
  ],
  exports: [
    GoogleAdsService,
    GoogleAdsTokenService,
    GoogleCampaignDraftService,
    GooglePublishService,
  ],
})
export class GoogleAdsModule {}
