import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacebookCampaign } from '../../db/entities/facebook-campaign.entity';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { MetaCampaignError } from '../../db/entities/meta-campaign-error.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { FacebookIntegrationAuditService } from '../facebook/facebook-integration-audit.service';
import { FacebookModule } from '../facebook/facebook.module';
import { FacebookCampaignController } from './facebook-campaign.controller';
import { FacebookCampaignService } from './facebook-campaign.service';
import { MetaCampaignDraftService } from './meta-campaign-draft.service';
import { MetaPublishService } from './meta-publish.service';
import { MetaPublishDiagnosticService } from './meta-publish-diagnostic.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FacebookCampaign,
      MetaCampaignDraft,
      MetaCampaignError,
      Restaurant,
      IntegrationAuditLog,
    ]),
    FacebookModule,
  ],
  controllers: [FacebookCampaignController],
  providers: [
    FacebookCampaignService,
    MetaCampaignDraftService,
    MetaPublishService,
    MetaPublishDiagnosticService,
    FacebookIntegrationAuditService,
  ],
  exports: [
    FacebookCampaignService,
    MetaPublishService,
    MetaPublishDiagnosticService,
  ],
})
export class FacebookCampaignModule {}
