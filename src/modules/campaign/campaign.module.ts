import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import { AuthModule } from '../auth/auth.module';
import { AutomationModule } from '../automation/automation.module';
import { BusinessHistoryModule } from '../business-history/business-history.module';
import { StripeModule } from '../stripe/stripe.module';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Campaign, Business, Funnel]),
    AuthModule,
    StripeModule,
    BusinessHistoryModule,
    forwardRef(() => AutomationModule),
  ],
  controllers: [CampaignController],
  providers: [CampaignService],
})
export class CampaignModule {}
