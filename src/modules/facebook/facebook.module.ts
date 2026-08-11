import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { MetaAdCampaignStatsSnapshot } from '../../db/entities/meta-ad-campaign-stats-snapshot.entity';
import { MetaOAuthSession } from '../../db/entities/meta-oauth-session.entity';
import { Business } from '../../db/entities/business.entity';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { BusinessModule } from '../business/business.module';
import { FacebookIntegrationAuditService } from './facebook-integration-audit.service';
import { FacebookMetaTokenService } from './facebook-meta-token.service';
import { FacebookWebhookController } from './facebook-webhook.controller';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Business,
      IntegrationAuditLog,
      MetaOAuthSession,
      MetaAdCampaignStatsSnapshot,
    ]),
    BusinessModule,
    AdminNotificationsModule,
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
