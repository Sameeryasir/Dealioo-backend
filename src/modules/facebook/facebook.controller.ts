import {
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
import { FacebookConnectionStatusDto } from './dto/facebook-connection-status.dto';
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
      `${getFrontendBaseUrl()}/facebook/success?restaurantId=${result.restaurantId}`,
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
}
