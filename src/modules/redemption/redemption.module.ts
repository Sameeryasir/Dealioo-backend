import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Customer } from '../../db/entities/customer.entity';
import { Coupon } from '../../db/entities/coupon.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { RedemptionLog } from '../../db/entities/redemption-log.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';
import { CouponService } from './coupon.service';
import { RedemptionController } from './redemption.controller';
import { RedemptionValidationService } from './redemption-validation.service';
import { RedemptionService } from './redemption.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Coupon,
      RedemptionLog,
      CustomerVisit,
      Customer,
      Campaign,
      Funnel,
      FunnelPayment,
      Restaurant,
    ]),
    AuthModule,
  ],
  controllers: [RedemptionController],
  providers: [CouponService, RedemptionValidationService, RedemptionService],
  exports: [CouponService],
})
export class RedemptionModule {}
