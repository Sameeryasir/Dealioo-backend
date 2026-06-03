import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';

@Module({
  imports: [TypeOrmModule.forFeature([Restaurant]), RestaurantModule],
  controllers: [FacebookController, FacebookWebhookController],
  providers: [FacebookService],
  exports: [FacebookService],
})
export class FacebookModule {}
