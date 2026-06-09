import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityEvent } from '../../db/entities/activity-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityEvent,
      Restaurant,
      Customer,
      FunnelPayment,
    ]),
    AuthModule,
    forwardRef(() => RedemptionModule),
  ],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
