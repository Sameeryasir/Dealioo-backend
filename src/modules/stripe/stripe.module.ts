import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { AuthModule } from '../auth/auth.module';
import { BusinessModule } from '../business/business.module';
import { StripeCatalogService } from './stripe-catalog.service';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Business, Campaign]),
    AuthModule,
    BusinessModule,
  ],
  controllers: [StripeController],
  providers: [StripeService, StripeCatalogService],
  exports: [StripeService, StripeCatalogService],
})
export class StripeModule {}
