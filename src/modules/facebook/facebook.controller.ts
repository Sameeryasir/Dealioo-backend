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
import { ConnectFacebookDto } from './dto/connect-facebook.dto';
import { FacebookAdAccountDto } from './dto/facebook-ad-account.dto';
import { FacebookAdCampaignStatsDto } from './dto/facebook-ad-campaign-stats.dto';
import { FacebookAdPixelDto } from './dto/facebook-ad-pixel.dto';
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

    const frontend = getFrontendBaseUrl().replace(/\/$/, '');

    // Not now / deny — redirect to Dealioo (never return raw API JSON in the browser).
    if (error?.trim()) {
      const reason = encodeURIComponent(
        errorDescription?.trim() ||
          error.trim() ||
          'Facebook connection was cancelled.',
      );
      return res.redirect(
        `${frontend}/facebook/connect/error?cancelled=1&reason=${reason}`,
      );
    }

    try {
      const result = await this.facebookService.handleOAuthCallback(
        code,
        state,
        error,
        errorDescription,
      );

      const granted = (result.grantedScopes ?? []).join(',');
      const grantedParam = granted
        ? `&granted=${encodeURIComponent(granted)}`
        : '';
      return res.redirect(
        `${frontend}/facebook/connected?businessId=${result.businessId}${grantedParam}`,
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Facebook connection failed. Please try again.';
      return res.redirect(
        `${frontend}/facebook/connect/error?reason=${encodeURIComponent(message)}`,
      );
    }
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect/:businessId')
  async connect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: ConnectFacebookDto,
  ): Promise<{ url: string; scopes: string[] }> {
    return this.facebookService.connect(req.user, businessId, body.scopes);
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
    @Query('insights') insightsRaw?: string,
    @Query('refresh') refreshRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('q') queryRaw?: string,
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

    const insightsNormalized = insightsRaw?.trim().toLowerCase();
    const includeInsights =
      insightsNormalized !== '0' &&
      insightsNormalized !== 'false' &&
      insightsNormalized !== 'no';
    const bypassCache =
      refreshRaw?.trim().toLowerCase() === '1' ||
      refreshRaw?.trim().toLowerCase() === 'true';
    const page = Number.parseInt(pageRaw ?? '', 10);
    const pageSize = Number.parseInt(pageSizeRaw ?? '', 10);

    return this.facebookService.getAdCampaignStats(business, {
      includeInsights,
      bypassCache,
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 4,
      query: queryRaw?.trim() || undefined,
    });
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
  @Get('ad-pixels/:businessId')
  async listAdPixels(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<FacebookAdPixelDto[]> {
    return this.facebookService.listAdPixelsForBusiness(req.user, businessId);
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
