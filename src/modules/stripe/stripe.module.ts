import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { IntegrationAuditLog } from '../../db/entities/integration-audit-log.entity';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { AuthModule } from '../auth/auth.module';
import { BusinessModule } from '../business/business.module';
import { StripeCatalogService } from './stripe-catalog.service';
import { StripeController } from './stripe.controller';
import { StripeIntegrationAuditService } from './stripe-integration-audit.service';
import { StripeService } from './stripe.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Business, Campaign, IntegrationAuditLog]),
    AuthModule,
    BusinessModule,
    AdminNotificationsModule,
  ],
  controllers: [StripeController],
  providers: [StripeService, StripeCatalogService, StripeIntegrationAuditService],
  exports: [StripeService, StripeCatalogService],
})
export class StripeModule {}
