import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import {
  CancelSubscriptionDto,
  SelectUserPlanDto,
} from './user-subscriptions.dto';
import {
  UserSubscriptionsService,
  type CancelUserSubscriptionResponse,
  type UserSubscriptionCheckoutResponse,
  type UserSubscriptionResponse,
} from './user-subscriptions.service';

@Controller('user-subscriptions')
export class UserSubscriptionsController {
  constructor(
    private readonly userSubscriptionsService: UserSubscriptionsService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMySubscription(
    @Req() req: { user: { id: number } },
  ): Promise<UserSubscriptionResponse | null> {
    return this.userSubscriptionsService.getActiveSubscriptionForUser(
      req.user.id,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  startCheckout(
    @Req() req: { user: { id: number } },
    @Body() dto: SelectUserPlanDto,
  ): Promise<UserSubscriptionCheckoutResponse> {
    return this.userSubscriptionsService.createCheckoutForUser(
      req.user.id,
      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('select-plan')
  selectPlan(
    @Req() req: { user: { id: number } },
    @Body() dto: SelectUserPlanDto,
  ): Promise<UserSubscriptionCheckoutResponse> {
    return this.userSubscriptionsService.createCheckoutForUser(
      req.user.id,
      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('complete')
  completeCheckout(
    @Req() req: { user: { id: number } },
    @Query('session_id') sessionId?: string,
  ): Promise<UserSubscriptionResponse> {
    return this.userSubscriptionsService.completeCheckout(
      req.user.id,
      sessionId ?? '',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('confirm-checkout')
  confirmCheckout(
    @Req() req: { user: { id: number } },
    @Query('session_id') sessionId?: string,
  ): Promise<UserSubscriptionResponse> {
    return this.userSubscriptionsService.completeCheckout(
      req.user.id,
      sessionId ?? '',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('cancel')
  cancelSubscription(
    @Req() req: { user: { id: number } },
    @Body() dto: CancelSubscriptionDto,
  ): Promise<CancelUserSubscriptionResponse> {
    return this.userSubscriptionsService.cancelSubscriptionForUser(
      req.user.id,
      dto,
    );
  }
}
