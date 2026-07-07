import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationExecution } from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { Coupon } from '../../db/entities/coupon.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { RedemptionLog } from '../../db/entities/redemption-log.entity';
import { AutomationModule } from '../automation/automation.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      Coupon,
      CustomerVisit,
      RedemptionLog,
      AutomationExecution,
      AutomationLog,
      FunnelEvent,
      CheckoutAccessToken,
    ]),
    forwardRef(() => AutomationModule),
  ],
  controllers: [CustomerController],
  providers: [CustomerService],
})
export class CustomerModule {}
