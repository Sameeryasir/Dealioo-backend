import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { RestaurantService } from '../restaurant/restaurant.service';
import { FacebookAdAccountDto } from './dto/facebook-ad-account.dto';
import { FacebookAdCampaignStatsDto } from './dto/facebook-ad-campaign-stats.dto';
import { FacebookConnectionStatusDto } from './dto/facebook-connection-status.dto';
import { SetFacebookAdAccountDto } from './dto/set-facebook-ad-account.dto';
import { FacebookService } from './facebook.service';

@Controller('facebook')
export class FacebookController {
  constructor(
    private readonly facebookService: FacebookService,
    private readonly restaurantService: RestaurantService,
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
      `${getFrontendBaseUrl()}/facebook/select-ad-account?restaurantId=${result.restaurantId}`,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect/:restaurantId')
  async connect(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<{ url: string }> {
    return this.facebookService.connect(req.user, restaurantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status/:restaurantId')
  async status(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<FacebookConnectionStatusDto> {
    const restaurant = await this.restaurantService.findOwnedByUserId(
      req.user.id,
      restaurantId,
    );

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    return this.facebookService.getConnectionStatus(restaurant);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('ads/campaign-stats/:restaurantId')
  async adCampaignStats(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<FacebookAdCampaignStatsDto> {
    const restaurant = await this.restaurantService.findOwnedByUserId(
      req.user.id,
      restaurantId,
    );

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    return this.facebookService.getAdCampaignStats(restaurant);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('ad-accounts/:restaurantId')
  async listAdAccounts(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<FacebookAdAccountDto[]> {
    return this.facebookService.listAdAccountsForRestaurant(
      req.user,
      restaurantId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('ad-account/:restaurantId')
  async setAdAccount(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Body() body: SetFacebookAdAccountDto,
  ): Promise<{ metaAdAccountId: string }> {
    return this.facebookService.setRestaurantAdAccount(
      req.user,
      restaurantId,
      body.adAccountId,
    );
  }
}
