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
import { BusinessService } from '../business/business.service';
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
    @Res() res: Response,
  ) {
    console.log('[Stripe OAuth] GET /stripe/callback/oauth', {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      state,
      error: error ?? null,
    });

    if (error) {
      throw new BadRequestException(error);
    }

    if (!code || !state) {
      throw new BadRequestException('Missing Stripe OAuth code or state.');
    }

    await this.stripeService.handleOAuthCallback(code, state);

    return res.redirect(`${getFrontendBaseUrl()}/stripe/connect/success`);
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
  @Get('dashboard-link/:businessId')
  async getDashboardLink(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ url: string }> {
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
  @Get(':businessId')
  async connectBusinessOAuth(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ) {
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
