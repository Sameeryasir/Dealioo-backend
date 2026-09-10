import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
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
import { requireAdminRole } from '../../utils/require-admin-role';
import { requireScannerRole } from '../../utils/require-scanner-role';
import { BusinessAccessService } from '../business-access/business-access.service';
import { RedemptionService } from '../redemption/redemption.service';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { FunnelAnalyticsService } from './funnel-analytics.service';
import { TrackFunnelAnalyticsDto } from './funnelEventDto/track-funnel-analytics.dto';
import { TrackFunnelEventDto } from './funnelEventDto/track-funnel-event.dto';
import { ScannerPurchaseDealsDto } from './funnelEventDto/scanner-purchase-deals.dto';
import { GetBusinessFunnelEventsQueryDto } from './funnelEventDto/get-business-funnel-events-query.dto';
import { GetBusinessTopCampaignsQueryDto } from './funnelEventDto/get-business-top-campaigns-query.dto';
import { GetFunnelGuestsQueryDto } from './funnelEventDto/get-funnel-guests-query.dto';
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
    private readonly businessAccessService: BusinessAccessService,
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
  @Post('business/:businessId/guest/:customerId/purchase-deals')
  @HttpCode(200)
  async purchaseDealsAtScanner(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: ScannerPurchaseDealsDto,
    @Req() req: AuthRequest,
  ) {
    requireScannerRole(req.user);
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.funnelEventService.purchaseDealsAtScanner({
      businessId,
      customerId,
      funnelIds: dto.funnelIds,
      purchaseMeans: dto.purchaseMeans,
      orderSubtotal: dto.orderSubtotal,
      extraItemsAmount: dto.extraItemsAmount ?? 0,
      extraItemNames: dto.extraItemNames,
      extraItems: dto.extraItems,
      staffUserId: req.user.id,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/customers/:customerId/journey')
  getCustomerJourney(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('campaignId', ParseIntPipe) campaignId: number,
    @Query('funnelId') funnelIdRaw?: string,
    @Query('funnelPaymentId') funnelPaymentIdRaw?: string,
  ) {
    const funnelId =
      funnelIdRaw != null && funnelIdRaw.trim() !== ''
        ? Number.parseInt(funnelIdRaw, 10)
        : null;
    const funnelPaymentId =
      funnelPaymentIdRaw != null && funnelPaymentIdRaw.trim() !== ''
        ? Number.parseInt(funnelPaymentIdRaw, 10)
        : null;
    return this.funnelEventService.getCustomerJourneyForBusiness({
      businessId,
      customerId,
      campaignId,
      funnelId:
        funnelId != null && Number.isFinite(funnelId) && funnelId > 0
          ? funnelId
          : null,
      funnelPaymentId:
        funnelPaymentId != null &&
        Number.isFinite(funnelPaymentId) &&
        funnelPaymentId > 0
          ? funnelPaymentId
          : null,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/events')
  async getBusinessFunnelEvents(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query() query: GetBusinessFunnelEventsQueryDto,
    @Req() req: AuthRequest,
  ) {
    await this.businessAccessService.assertAnyPermission(
      req.user,
      businessId,
      ['orders'],
      'You do not have permission to view orders for this business.',
    );
    return this.funnelEventService.getBusinessFunnelEvents(
      businessId,
      query.page ?? 1,
      query.limit ?? 10,
      query,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/performance/top-campaigns')
  async getBusinessTopEarningCampaigns(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query() query: GetBusinessTopCampaignsQueryDto,
    @Req() req: AuthRequest,
  ) {
    requireAdminRole(
      req.user,
      'Only Admin or Super Admin can view performance for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      req.user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }

    const from = query.from?.trim() ? new Date(query.from) : null;
    const to = query.to?.trim() ? new Date(query.to) : null;

    return this.funnelEventService.getBusinessTopEarningCampaigns({
      businessId,
      from:
        from != null && !Number.isNaN(from.getTime()) ? from : null,
      to: to != null && !Number.isNaN(to.getTime()) ? to : null,
      limit: query.limit ?? 10,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId/guests')
  getFunnelGuests(
    @Param('funnelId', ParseIntPipe) funnelId: number,
    @Query() query: GetFunnelGuestsQueryDto,
  ) {
    return this.funnelEventService.getFunnelGuests(
      funnelId,
      query.page ?? 1,
      query.limit ?? 10,
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
