import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import { AuthModule } from '../auth/auth.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { FunnelController } from './funnel.controller';
import { FunnelService } from './funnel.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Funnel, Campaign, FunnelPayment, Business]),
    AuthModule,
    RedemptionModule,
  ],
  controllers: [FunnelController],
  providers: [FunnelService],
})
export class FunnelModule {}
