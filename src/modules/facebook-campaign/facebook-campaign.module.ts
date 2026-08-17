import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacebookCampaign } from '../../db/entities/facebook-campaign.entity';
import { MetaCampaignDraft } from '../../db/entities/meta-campaign-draft.entity';
import { MetaCampaignError } from '../../db/entities/meta-campaign-error.entity';
import { MetaCampaignMedia } from '../../db/entities/meta-campaign-media.entity';
import { MetaPublishAttempt } from '../../db/entities/meta-publish-attempt.entity';
import { Business } from '../../db/entities/business.entity';
import { SpacesModule } from '../spaces/spaces.module';
import { FacebookModule } from '../facebook/facebook.module';
import { FacebookCampaignController } from './facebook-campaign.controller';
import { FacebookCampaignService } from './facebook-campaign.service';
import { MetaCampaignDraftService } from './meta-campaign-draft.service';
import { MediaService } from './media.service';
import { MetaAdsService } from './meta-ads.service';
import { AdPublishService } from './ad-publish.service';
import { META_PUBLISH_QUEUE } from './meta-publish-queue.constants';
import { MetaPublishQueueProcessor } from './meta-publish-queue.processor';
import { MetaPublishRealtimeService } from './meta-publish-realtime.service';
import { MetaPublishService } from './meta-publish.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FacebookCampaign,
      MetaCampaignDraft,
      MetaCampaignError,
      MetaCampaignMedia,
      MetaPublishAttempt,
      Business,
    ]),
    BullModule.registerQueue({ name: META_PUBLISH_QUEUE }),
    FacebookModule,
    SpacesModule,
  ],
  controllers: [FacebookCampaignController],
  providers: [
    FacebookCampaignService,
    MetaCampaignDraftService,
    MediaService,
    MetaAdsService,
    MetaPublishService,
    AdPublishService,
    MetaPublishQueueProcessor,
    MetaPublishRealtimeService,
  ],
  exports: [
    FacebookCampaignService,
    MetaPublishService,
    AdPublishService,
    MediaService,
    MetaAdsService,
  ],
})
export class FacebookCampaignModule {}
