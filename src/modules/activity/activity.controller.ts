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
import { ActivityEventType } from '../../db/entities/activity-event.entity';
import { RedemptionService } from '../redemption/redemption.service';
import { ActivityService } from './activity.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

function parseEventType(raw?: string): ActivityEventType | null {
  if (!raw?.trim()) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'all') return null;
  if (Object.values(ActivityEventType).includes(value as ActivityEventType)) {
    return value as ActivityEventType;
  }
  return null;
}

function parseDate(raw?: string): Date | null {
  if (!raw?.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req!.user.id,
      req!.user.role.name,
    );

    return this.activityService.getBusinessEvents(businessId, {
      page,
      limit,
      eventType: parseEventType(eventType),
      from: parseDate(from),
      to: parseDate(to),
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/summary')
  async getBusinessSummary(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Req() req?: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req!.user.id,
      req!.user.role.name,
    );

    return this.activityService.getBusinessSummary(businessId, {
      from: parseDate(from),
      to: parseDate(to),
    });
  }
}
