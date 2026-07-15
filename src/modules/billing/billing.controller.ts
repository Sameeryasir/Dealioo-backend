import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import { BillingService } from './billing.service';
import type { UpgradeSubscriptionResponse } from './billing.types';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upgrade')
  upgrade(
    @Req() req: { user: { id: number } },
    @Body() dto: UpgradeSubscriptionDto,
  ): Promise<UpgradeSubscriptionResponse> {
    return this.billingService.upgradeSubscription(req.user.id, dto);
  }
}
