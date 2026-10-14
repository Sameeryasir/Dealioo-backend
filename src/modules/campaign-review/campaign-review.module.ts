import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignReview } from '../../db/entities/campaign-review.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { BusinessAccessModule } from '../business-access/business-access.module';
import { CampaignReviewController } from './campaign-review.controller';
import { CampaignReviewService } from './campaign-review.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CampaignReview, Campaign]),
    BusinessAccessModule,
  ],
  controllers: [CampaignReviewController],
  providers: [CampaignReviewService],
  exports: [CampaignReviewService],
})
export class CampaignReviewModule {}
