import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { requireAdminRole } from '../../utils/require-admin-role';
import { BusinessService } from '../business/business.service';
import { StripeConnectionStatusDto } from './dto/stripe-connection-status.dto';
import { StripeService } from './stripe.service';

@Controller('stripe')
export class StripeController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly businessService: BusinessService,
  ) {}

  @Get('callback/oauth')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const frontend = getFrontendBaseUrl().replace(/\/$/, '');
    const resolvedBusinessId =
      this.stripeService.resolveOAuthStateBusinessId(state);
    const businessQuery =
      resolvedBusinessId != null
        ? `businessId=${encodeURIComponent(String(resolvedBusinessId))}`
        : '';

    if (error?.trim()) {
      const reason = errorDescription?.trim() || error.trim() || 'access_denied';
      await this.stripeService.notifyConnectFailure(state, reason);
      const qs = [
        businessQuery,
        `error=${encodeURIComponent(reason)}`,
      ]
        .filter(Boolean)
        .join('&');
      return res.redirect(`${frontend}/stripe/success?${qs}`);
    }

    if (!code || !state) {
      const reason = 'Missing Stripe OAuth code or state.';
      await this.stripeService.notifyConnectFailure(state, reason);
      return res.redirect(
        `${frontend}/stripe/success?error=${encodeURIComponent(reason)}`,
      );
    }

    try {
      await this.stripeService.handleOAuthCallback(code, state);
      return res.redirect(
        `${frontend}/stripe/success${businessQuery ? `?${businessQuery}` : ''}`,
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Stripe account connection failed.';
      await this.stripeService.notifyConnectFailure(state, message);
      const qs = [
        businessQuery,
        `error=${encodeURIComponent(message)}`,
      ]
        .filter(Boolean)
        .join('&');
      return res.redirect(`${frontend}/stripe/success?${qs}`);
    }
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect/:businessId')
  async connect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ url: string }> {
    return this.stripeService.connect(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect-abort/:businessId')
  async abortConnect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ restored: true }> {
    return this.stripeService.abortOAuthConnect(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect/:businessId')
  async disconnect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ disconnected: true }> {
    return this.stripeService.disconnectStripeForBusiness(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('dashboard-link/:businessId')
  async getDashboardLink(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ url: string }> {
    requireAdminRole(
      req.user,
      'You do not have permission to open the Stripe dashboard for this account.',
    );

    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    if (!business.stripeAccountId) {
      throw new BadRequestException('Stripe account not connected');
    }

    return this.stripeService.createDashboardLoginLink(
      business.stripeAccountId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status/:businessId')
  async status(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<StripeConnectionStatusDto> {
    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.stripeService.getConnectionStatus(business);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':businessId')
  async connectBusinessOAuth(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ) {
    requireAdminRole(
      req.user,
      'You do not have permission to connect Stripe for this account.',
    );

    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.stripeService.createOAuthConnectUrl(businessId);
  }
}
