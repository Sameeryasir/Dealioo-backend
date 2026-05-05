import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';
import { FunnelController } from './funnel.controller';
import { FunnelService } from './funnel.service';

@Module({
  imports: [TypeOrmModule.forFeature([Funnel, Restaurant]), AuthModule],
  controllers: [FunnelController],
  providers: [FunnelService],
})
export class FunnelModule {}
