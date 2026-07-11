import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { RedemptionService } from '../redemption/redemption.service';
import { ActivityService } from './activity.service';
import {
  GetBusinessActivityEventsQueryDto,
  GetBusinessActivityQueryDto,
} from './activityDto/get-business-activity-query.dto';
import {
  parseActivityEventTypeFilter,
  resolveActivityDateRange,
} from './activity-filters.util';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

function parseDate(raw?: string): Date | null {
  if (!raw?.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseActivityQueryDates(query: GetBusinessActivityQueryDto): {
  from: Date;
  to: Date;
} {
  return resolveActivityDateRange(parseDate(query.from), parseDate(query.to));
}

@Controller('activity')
export class ActivityController {
  constructor(
    private readonly activityService: ActivityService,
    private readonly redemptionService: RedemptionService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/events')
  async getBusinessEvents(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query() query: GetBusinessActivityEventsQueryDto,
    @Req() req?: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req!.user.id,
      req!.user.role.name,
    );

    const range = parseActivityQueryDates(query);

    return this.activityService.getBusinessEvents(businessId, {
      page: query.page,
      limit: query.limit,
      eventType: parseActivityEventTypeFilter(query.eventType),
      from: range.from,
      to: range.to,
      search: query.search,
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/summary/monthly')
  async getBusinessSummaryMonthly(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('months', new DefaultValuePipe(6), ParseIntPipe) months: number,
    @Req() req?: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req!.user.id,
      req!.user.role.name,
    );

    return this.activityService.getBusinessSummaryMonthly(businessId, months);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/summary')
  async getBusinessSummary(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query() query: GetBusinessActivityQueryDto,
    @Req() req?: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req!.user.id,
      req!.user.role.name,
    );

    const range = parseActivityQueryDates(query);

    return this.activityService.getBusinessSummary(businessId, {
      eventType: parseActivityEventTypeFilter(query.eventType),
      from: range.from,
      to: range.to,
    });
  }
}
