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
import { RestaurantService } from '../restaurant/restaurant.service';
import { StripeService } from './stripe.service';

@Controller('stripe')
export class StripeController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly restaurantService: RestaurantService,
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

    const frontendBase =
      process.env.FRONTEND_URL ??
      process.env.CORS_ORIGIN ??
      'http://localhost:3000';

    return res.redirect(`${frontendBase}/stripe/connect/success`);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect/:restaurantId')
  async connect(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<{ url: string }> {
    return this.stripeService.connect(req.user, restaurantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('dashboard-link/:restaurantId')
  async getDashboardLink(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ): Promise<{ url: string }> {
    const restaurant = await this.restaurantService.findOwnedByUserId(
      req.user.id,
      restaurantId,
    );

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    if (!restaurant.stripeAccountId) {
      throw new BadRequestException('Stripe account not connected');
    }

    return this.stripeService.createDashboardLoginLink(
      restaurant.stripeAccountId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':restaurantId')
  async connectRestaurantOAuth(
    @Req() req,
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
  ) {
    const restaurant = await this.restaurantService.findOwnedByUserId(
      req.user.id,
      restaurantId,
    );

    if (!restaurant) {
      throw new NotFoundException(
        'Restaurant not found or you do not own this restaurant.',
      );
    }

    return this.stripeService.createOAuthConnectUrl(restaurantId);
  }
}
