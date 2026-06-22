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
import { RestaurantService } from '../restaurant/restaurant.service';
import { GoogleAdsCampaignStatsDto } from './dto/google-ads-campaign-stats.dto';
import { GoogleAdsConnectionStatusDto } from './dto/google-ads-connection-status.dto';
import { GoogleAdsCustomerDto } from './dto/google-ads-customer.dto';
import { SetGoogleAdsCustomerDto } from './dto/set-google-ads-customer.dto';
import { GoogleAdsService } from './google-ads.service';

@Controller('google-ads')
export class GoogleAdsController {
  constructor(
    private readonly googleAdsService: GoogleAdsService,
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
    const result = await this.googleAdsService.handleOAuthCallback(
      code,
      state,
      error,
      errorDescription,
    );

    return res.redirect(
      `${getFrontendBaseUrl()}/google/select-customer?restaurantId=${result.restaurantId}`,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect/:restaurantId')
  async connect(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<{ url: string }> {
    return this.googleAdsService.connect(req.user, restaurantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status/:restaurantId')
  async status(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<GoogleAdsConnectionStatusDto> {
    const restaurant = await this.restaurantService.findOwnedByUserId(
      req.user.id,
      restaurantId,
    );

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    return this.googleAdsService.getConnectionStatus(restaurant);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('ads/campaign-stats/:restaurantId')
  async adCampaignStats(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<GoogleAdsCampaignStatsDto> {
    const restaurant = await this.restaurantService.findOwnedByUserId(
      req.user.id,
      restaurantId,
    );

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    return this.googleAdsService.getAdCampaignStats(restaurant);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('customers/:restaurantId')
  async listCustomers(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<GoogleAdsCustomerDto[]> {
    return this.googleAdsService.listCustomersForRestaurant(
      req.user,
      restaurantId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('customer/:restaurantId')
  async setCustomer(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Body() body: SetGoogleAdsCustomerDto,
  ): Promise<{ googleCustomerId: string }> {
    return this.googleAdsService.setRestaurantCustomer(
      req.user,
      restaurantId,
      body.customerId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect/:restaurantId')
  async disconnect(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<{ disconnected: true }> {
    return this.googleAdsService.disconnectGoogleAdsForRestaurant(
      req.user,
      restaurantId,
    );
  }
}
