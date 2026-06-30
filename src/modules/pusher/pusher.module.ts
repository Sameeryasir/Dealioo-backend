import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedemptionModule } from '../redemption/redemption.module';
import { PusherController } from './pusher.controller';
import { PusherService } from './pusher.service';

@Global()
@Module({
  imports: [ConfigModule, RedemptionModule],
  controllers: [PusherController],
  providers: [PusherService],
  exports: [PusherService],
})
export class PusherModule {}
