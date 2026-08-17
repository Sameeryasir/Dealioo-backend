import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import { BillingService } from './billing.service';
import type {
  BillingDetailsUpdateResponse,
  BillingOverviewResponse,
  BillingPaymentMethodUpdateResponse,
  BillingPortalResponse,
  BillingSetupIntentResponse,
  ResumeSubscriptionResponse,
  UpgradeSubscriptionResponse,
} from './billing.types';
import { ConfirmPaymentMethodDto } from './dto/confirm-payment-method.dto';
import { UpdateBillingDetailsDto } from './dto/update-billing-details.dto';
import { UpgradeSubscriptionDto } from './dto/upgrade-subscription.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @UseGuards(JwtAuthGuard)
  @Get('overview')
  getOverview(
    @Req() req: { user: { id: number } },
  ): Promise<BillingOverviewResponse> {
    return this.billingService.getOverview(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('setup-intent')
  createSetupIntent(
    @Req() req: { user: { id: number } },
  ): Promise<BillingSetupIntentResponse> {
    return this.billingService.createSetupIntent(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('payment-method')
  confirmPaymentMethod(
    @Req() req: { user: { id: number } },
    @Body() dto: ConfirmPaymentMethodDto,
  ): Promise<BillingPaymentMethodUpdateResponse> {
    return this.billingService.confirmPaymentMethod(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('customer')
  updateCustomer(
    @Req() req: { user: { id: number } },
    @Body() dto: UpdateBillingDetailsDto,
  ): Promise<BillingDetailsUpdateResponse> {
    return this.billingService.updateBillingDetails(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('resume')
  resume(
    @Req() req: { user: { id: number } },
  ): Promise<ResumeSubscriptionResponse> {
    return this.billingService.resumeSubscription(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('portal')
  createPortal(
    @Req() req: { user: { id: number } },
  ): Promise<BillingPortalResponse> {
    return this.billingService.createBillingPortalSession(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upgrade')
  upgrade(
    @Req() req: { user: { id: number } },
    @Body() dto: UpgradeSubscriptionDto,
  ): Promise<UpgradeSubscriptionResponse> {
    return this.billingService.upgradeSubscription(req.user.id, dto);
  }
}
