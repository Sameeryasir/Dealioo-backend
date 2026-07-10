import {
  Body,
  Controller,
  Get,
  HttpException,
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
import { GoogleAdsCampaignStatsDto } from './dto/google-ads-campaign-stats.dto';
import { GoogleAdsConnectionStatusDto } from './dto/google-ads-connection-status.dto';
import { GoogleAdsCustomerDto } from './dto/google-ads-customer.dto';
import { SetGoogleAdsCustomerDto } from './dto/set-google-ads-customer.dto';
import { GoogleAdsService } from './google-ads.service';

function readHttpErrorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const response = err.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    if (typeof response === 'object' && response && 'message' in response) {
      const message = (response as { message?: string | string[] }).message;
      if (Array.isArray(message)) {
        return message.join(' ');
      }
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return 'Google connection failed. Try again from Settings → Integrations.';
}

@Controller('google-ads')
export class GoogleAdsController {
  constructor(
    private readonly googleAdsService: GoogleAdsService,
    private readonly businessService: BusinessService,
  ) {}

  @Get('callback/oauth')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('scope') scope: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const frontendBase = getFrontendBaseUrl();

    try {
      const result = await this.googleAdsService.handleOAuthCallback(
        code,
        state,
        error,
        errorDescription,
        scope,
      );

      return res.redirect(
        `${frontendBase}/google/select-customer?businessId=${result.businessId}`,
      );
    } catch (err) {
      const businessId =
        this.googleAdsService.parseBusinessIdFromOAuthState(state);
      const params = new URLSearchParams({
        error: readHttpErrorMessage(err),
      });
      if (businessId != null) {
        params.set('businessId', String(businessId));
      }

      return res.redirect(
        `${frontendBase}/google/select-customer?${params.toString()}`,
      );
    }
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect/:businessId')
  async connect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ url: string }> {
    return this.googleAdsService.connect(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect-abort/:businessId')
  async abortConnect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ restored: true }> {
    return this.googleAdsService.abortOAuthConnect(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status/:businessId')
  async status(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<GoogleAdsConnectionStatusDto> {
    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.googleAdsService.getConnectionStatus(business);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('ads/campaign-stats/:businessId')
  async adCampaignStats(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<GoogleAdsCampaignStatsDto> {
    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.googleAdsService.getAdCampaignStats(business);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('customers/:businessId')
  async listCustomers(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<GoogleAdsCustomerDto[]> {
    return this.googleAdsService.listCustomersForBusiness(
      req.user,
      businessId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('customer/:businessId')
  async setCustomer(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SetGoogleAdsCustomerDto,
  ): Promise<{ googleCustomerId: string }> {
    return this.googleAdsService.setBusinessCustomer(
      req.user,
      businessId,
      body.customerId,
      body.managerCustomerId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect/:businessId')
  async disconnect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ disconnected: true }> {
    return this.googleAdsService.disconnectGoogleAdsForBusiness(
      req.user,
      businessId,
    );
  }
}

