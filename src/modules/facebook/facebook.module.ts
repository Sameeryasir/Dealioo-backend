import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { FacebookIntegrationAuditService } from './facebook-integration-audit.service';
import { FacebookMetaTokenService } from './facebook-meta-token.service';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Restaurant, IntegrationAuditLog]),
    RestaurantModule,
  ],
  controllers: [FacebookController, FacebookWebhookController],
  providers: [
    FacebookService,
    FacebookIntegrationAuditService,
    FacebookMetaTokenService,
  ],
  exports: [FacebookService, FacebookMetaTokenService],
})
export class FacebookModule {}
