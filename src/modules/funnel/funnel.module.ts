import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelVersion } from '../../db/entities/funnel-version.entity';
import { Business } from '../../db/entities/business.entity';
import { AuthModule } from '../auth/auth.module';
import { BusinessHistoryModule } from '../business-history/business-history.module';
import { FunnelPagesModule } from '../funnel-pages/funnel-pages.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { FunnelController } from './funnel.controller';
import { FunnelService } from './funnel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Funnel,
      FunnelVersion,
      Campaign,
      FunnelPayment,
      Business,
    ]),
    AuthModule,
    BusinessHistoryModule,
    RedemptionModule,
    FunnelPagesModule,
  ],
  controllers: [FunnelController],
  providers: [FunnelService],
  exports: [FunnelService],
})
export class FunnelModule {}
