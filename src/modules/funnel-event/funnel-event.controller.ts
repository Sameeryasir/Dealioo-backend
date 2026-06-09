import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { requireScannerRole } from '../../utils/require-scanner-role';
import { RedemptionService } from '../redemption/redemption.service';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { TrackFunnelAnalyticsDto } from './funnelEventDto/track-funnel-analytics.dto';
import { TrackFunnelEventDto } from './funnelEventDto/track-funnel-event.dto';
import { ScannerPurchaseDealsDto } from './funnelEventDto/scanner-purchase-deals.dto';
import { clampOverviewMonths } from './overview-monthly.util';
import { FunnelEventService } from './funnel-event.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('funnel-event')
export class FunnelEventController {
  constructor(
    private readonly funnelEventService: FunnelEventService,
    private readonly funnelAnalyticsService: FunnelAnalyticsService,
    private readonly redemptionService: RedemptionService,
  ) {}

  @SkipThrottle()
  @Post('track')
  @HttpCode(200)
  track(@Body() dto: TrackFunnelEventDto): Promise<FunnelEvent> {
    return this.funnelEventService.track(dto);
  }

  @SkipThrottle()
  @Post('track-analytics')
  @HttpCode(200)
  trackAnalytics(
    @Body() dto: TrackFunnelAnalyticsDto,
  ): Promise<FunnelAnalyticsEvent> {
    return this.funnelAnalyticsService.trackAnalyticsEvent(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('restaurant/:restaurantId/guest/:customerId/purchase-deals')
  @HttpCode(200)
  async purchaseDealsAtScanner(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: ScannerPurchaseDealsDto,
    @Req() req: AuthRequest,
  ) {
    requireScannerRole(req.user);
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.funnelEventService.purchaseDealsAtScanner({
      restaurantId,
      customerId,
      funnelIds: dto.funnelIds,
      orderSubtotal: dto.orderSubtotal,
      staffUserId: req.user.id,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/events')
  getRestaurantFunnelEvents(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.funnelEventService.getRestaurantFunnelEvents(
      restaurantId,
      page,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId/stats')
  getStats(@Param('funnelId', ParseIntPipe) funnelId: number) {
    return this.funnelEventService.getStats(funnelId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId/stats/monthly')
  getStatsMonthly(
    @Param('funnelId', ParseIntPipe) funnelId: number,
    @Query('months') months?: string,
  ) {
    return this.funnelEventService.getStatsMonthly(
      funnelId,
      clampOverviewMonths(months),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId/analytics-overview')
  getAnalyticsOverview(@Param('funnelId', ParseIntPipe) funnelId: number) {
    return this.funnelAnalyticsService.getAnalyticsOverview(funnelId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId/analytics-overview/monthly')
  getAnalyticsOverviewMonthly(
    @Param('funnelId', ParseIntPipe) funnelId: number,
    @Query('months') months?: string,
  ) {
    return this.funnelAnalyticsService.getAnalyticsOverviewMonthly(
      funnelId,
      clampOverviewMonths(months),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId/dropoff')
  getDropoff(@Param('funnelId', ParseIntPipe) funnelId: number) {
    return this.funnelAnalyticsService.getFunnelDropoff(funnelId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId/traffic-sources')
  getTrafficSources(@Param('funnelId', ParseIntPipe) funnelId: number) {
    return this.funnelAnalyticsService.getTrafficSources(funnelId);
  }
}
