import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import { BillingAccountOwnerGuard } from './billing-account-owner.guard';
import { BillingService } from './billing.service';
import type {
  BillingDetailsUpdateResponse,
  BillingInvoiceLinksResponse,
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
@UseGuards(JwtAuthGuard, BillingAccountOwnerGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('overview')
  getOverview(
    @Req() req: { user: { id: number } },
  ): Promise<BillingOverviewResponse> {
    return this.billingService.getOverview(req.user.id);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('setup-intent')
  createSetupIntent(
    @Req() req: { user: { id: number } },
  ): Promise<BillingSetupIntentResponse> {
    return this.billingService.createSetupIntent(req.user.id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('payment-method')
  confirmPaymentMethod(
    @Req() req: { user: { id: number } },
    @Body() dto: ConfirmPaymentMethodDto,
  ): Promise<BillingPaymentMethodUpdateResponse> {
    return this.billingService.confirmPaymentMethod(req.user.id, dto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Patch('customer')
  updateCustomer(
    @Req() req: { user: { id: number } },
    @Body() dto: UpdateBillingDetailsDto,
  ): Promise<BillingDetailsUpdateResponse> {
    return this.billingService.updateBillingDetails(req.user.id, dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('invoices/:invoiceId/links')
  getInvoiceLinks(
    @Req() req: { user: { id: number } },
    @Param('invoiceId') invoiceId: string,
  ): Promise<BillingInvoiceLinksResponse> {
    return this.billingService.getInvoiceLinks(req.user.id, invoiceId);
  }

  @Post('resume')
  resume(
    @Req() req: { user: { id: number } },
  ): Promise<ResumeSubscriptionResponse> {
    return this.billingService.resumeSubscription(req.user.id);
  }

  @Post('portal')
  createPortal(
    @Req() req: { user: { id: number } },
  ): Promise<BillingPortalResponse> {
    return this.billingService.createBillingPortalSession(req.user.id);
  }

  @Post('upgrade')
  upgrade(
    @Req() req: { user: { id: number } },
    @Body() dto: UpgradeSubscriptionDto,
  ): Promise<UpgradeSubscriptionResponse> {
    return this.billingService.upgradeSubscription(req.user.id, dto);
  }
}
