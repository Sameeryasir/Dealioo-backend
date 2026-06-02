import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { TrackFunnelAnalyticsDto } from './funnelEventDto/track-funnel-analytics.dto';
import { TrackFunnelEventDto } from './funnelEventDto/track-funnel-event.dto';
import { clampOverviewMonths } from './overview-monthly.util';
import { FunnelEventService } from './funnel-event.service';

@Controller('funnel-event')
export class FunnelEventController {
  constructor(
    private readonly funnelEventService: FunnelEventService,
    private readonly funnelAnalyticsService: FunnelAnalyticsService,
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
