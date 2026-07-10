import {
  Body,
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
import { FacebookAdAccountDto } from './dto/facebook-ad-account.dto';
import { FacebookAdCampaignStatsDto } from './dto/facebook-ad-campaign-stats.dto';
import { FacebookConnectionStatusDto } from './dto/facebook-connection-status.dto';
import { FacebookPageDto } from './dto/facebook-page.dto';
import { SetFacebookAdAccountDto } from './dto/set-facebook-ad-account.dto';
import { FacebookService } from './facebook.service';

@Controller('facebook')
export class FacebookController {
  constructor(
    private readonly facebookService: FacebookService,
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
    console.log('[Facebook OAuth] GET /facebook/callback/oauth', {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      state,
      error: error ?? null,
    });

    const result = await this.facebookService.handleOAuthCallback(
      code,
      state,
      error,
      errorDescription,
    );

    return res.redirect(
      `${getFrontendBaseUrl()}/facebook/select-ad-account?businessId=${result.businessId}`,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect/:businessId')
  async connect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ url: string }> {
    return this.facebookService.connect(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status/:businessId')
  async status(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<FacebookConnectionStatusDto> {
    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.facebookService.getConnectionStatus(business);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('ads/campaign-stats/:businessId')
  async adCampaignStats(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('websiteUrl') websiteUrl?: string,
  ): Promise<FacebookAdCampaignStatsDto> {
    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.facebookService.getAdCampaignStats(business, websiteUrl);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('pages/:businessId')
  async listPages(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<FacebookPageDto[]> {
    return this.facebookService.listPagesForBusiness(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('ad-accounts/:businessId')
  async listAdAccounts(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<FacebookAdAccountDto[]> {
    return this.facebookService.listAdAccountsForBusiness(
      req.user,
      businessId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('ad-account/:businessId')
  async setAdAccount(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SetFacebookAdAccountDto,
  ): Promise<{ metaAdAccountId: string }> {
    return this.facebookService.setBusinessAdAccount(
      req.user,
      businessId,
      body.adAccountId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect/:businessId')
  async disconnect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ disconnected: true }> {
    return this.facebookService.disconnectFacebookForBusiness(
      req.user,
      businessId,
    );
  }
}
