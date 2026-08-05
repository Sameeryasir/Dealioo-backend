import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetaProductEvent } from '../../db/entities/meta-product-event.entity';
import { UserFacebookAttribution } from '../../db/entities/user-facebook-attribution.entity';
import { AuthModule } from '../auth/auth.module';
import { ProductMetaCapiService } from './product-meta-capi.service';
import { ProductMetaTrackingController } from './product-meta-tracking.controller';
import { PRODUCT_META_CAPI_QUEUE } from './product-meta-tracking-queue.constants';
import { ProductMetaTrackingQueueProcessor } from './product-meta-tracking-queue.processor';
import { ProductMetaTrackingService } from './product-meta-tracking.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([MetaProductEvent, UserFacebookAttribution]),
    BullModule.registerQueue({ name: PRODUCT_META_CAPI_QUEUE }),
  ],
  controllers: [ProductMetaTrackingController],
  providers: [
    ProductMetaTrackingService,
    ProductMetaCapiService,
    ProductMetaTrackingQueueProcessor,
  ],
  exports: [ProductMetaTrackingService, ProductMetaCapiService],
})
export class ProductMetaTrackingModule {}
