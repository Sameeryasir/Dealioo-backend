import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { CouponStatus } from '../../../db/entities/coupon.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../../db/entities/funnel-event.entity';
import { AutomationPurpose } from '../../../db/entities/automation-purpose.enum';
import { CustomerVisit } from '../../../db/entities/customer-visit.entity';
import { CouponService } from '../../redemption/coupon.service';
import { isCustomerVisitedCondition } from '../automation-visit.util';
import type {
  AutomationConditionContext,
  AutomationConditionEvaluator,
} from '../automation-condition.types';

@Injectable()
export class CustomerVisitedConditionEvaluator
  implements AutomationConditionEvaluator
{
  constructor(
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(CustomerVisit)
    private readonly customerVisitRepository: Repository<CustomerVisit>,
    private readonly couponService: CouponService,
  ) {}

  matches(conditionType: string): boolean {
    return isCustomerVisitedCondition(conditionType);
  }

  async evaluate(context: AutomationConditionContext): Promise<boolean> {
    const execution = context.execution;
    const campaignId = execution.automation?.campaignId;
    if (!campaignId) {
      return false;
    }

    if (execution.automation?.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
      const funnelId = execution.automation.funnelId;
      if (!funnelId) {
        return false;
      }

      const event = await this.funnelEventRepository.findOne({
        where: {
          customerId: execution.customerId,
          funnelId,
          funnelPaymentId: Not(IsNull()),
          eventType: FunnelEventType.PAYMENT,
        },
        order: { createdAt: 'DESC' },
      });

      if (!event?.funnelPaymentId) {
        return false;
      }

      const coupon = await this.couponService.findLatestByPaymentId(
        event.funnelPaymentId,
      );
      if (!coupon) {
        return false;
      }

      return coupon.status === CouponStatus.REDEEMED;
    }

    return this.customerVisitRepository.exist({
      where: {
        customerId: execution.customerId,
        campaignId,
      },
    });
  }
}
