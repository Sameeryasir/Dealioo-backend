import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { AuthModule } from '../auth/auth.module';
import { FunnelController } from './funnel.controller';
import { FunnelService } from './funnel.service';

@Module({
  imports: [TypeOrmModule.forFeature([Funnel, Campaign]), AuthModule],
  controllers: [FunnelController],
  providers: [FunnelService],
})
export class FunnelModule {}
