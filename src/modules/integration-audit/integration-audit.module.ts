import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { AuthModule } from '../auth/auth.module';
import { FacebookModule } from '../facebook/facebook.module';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { StripeModule } from '../stripe/stripe.module';
import { IntegrationAuditController } from './integration-audit.controller';
import { IntegrationAuditService } from './integration-audit.service';
import { IntegrationsStatusController } from './integrations-status.controller';
import { IntegrationsStatusService } from './integrations-status.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([IntegrationAuditLog]),
    AuthModule,
    StripeModule,
    FacebookModule,
    GoogleAdsModule,
  ],
  controllers: [IntegrationAuditController, IntegrationsStatusController],
  providers: [IntegrationAuditService, IntegrationsStatusService],
})
export class IntegrationAuditModule {}
