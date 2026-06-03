import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacebookConnection } from '../../../db/entities/facebook-connection.entity';
import { FacebookPage } from '../../../db/entities/facebook-page.entity';
import { User } from '../../../db/entities/user.entity';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FacebookConnection, FacebookPage, User]),
  ],
  controllers: [FacebookController, FacebookWebhookController],
  providers: [FacebookService],
  exports: [FacebookService],
})
export class FacebookModule {}
