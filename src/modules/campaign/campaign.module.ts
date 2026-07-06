import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign, Restaurant, Funnel]),
    AuthModule,
  ],
  controllers: [CampaignController],
  providers: [CampaignService],
})
export class CampaignModule {}
