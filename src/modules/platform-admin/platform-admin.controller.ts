import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { User } from '../../db/entities/user.entity';
import { CreateAdminBusinessDto } from './dto/create-admin-business.dto';
import { CreateAdminPlanDto } from './dto/create-admin-plan.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { AssignAdminTwilioNumberDto } from './dto/assign-admin-twilio-number.dto';
import { PurchaseAdminTwilioNumberDto } from './dto/purchase-admin-twilio-number.dto';
import { SearchAdminTwilioNumbersDto } from './dto/search-admin-twilio-numbers.dto';
import { SetAdminTwilioWebhookDto } from './dto/set-admin-twilio-webhook.dto';
import { UpdateAdminPlanDto } from './dto/update-admin-plan.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { PlatformAdminService } from './platform-admin.service';
import { SuperAdminGuard } from './super-admin.guard';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get('overview/dashboard')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getDashboardPanel(
    @Req() req: { user: User },
    @Query('period') period?: string,
    @Query('month') month?: string,
    @Query('timezone') timeZone?: string,
  ) {
    return this.platformAdminService.getDashboardPanel(
      req.user,
      period,
      month,
      timeZone,
    );
  }

  @Get('users')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listUsers(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('tab') tab?: string,
    @Query('sort') sort?: string,
  ) {
    return this.platformAdminService.listUsers(
      req.user,
      page,
      limit,
      search,
      tab,
      sort,
    );
  }

  @Post('users')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  createUser(@Req() req: { user: User }, @Body() body: CreateAdminUserDto) {
    return this.platformAdminService.createUser(req.user, body);
  }

  @Get('roles')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listRoles(@Req() req: { user: User }) {
    return this.platformAdminService.listAssignableRoles(req.user);
  }

  @Patch('users/:id')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  updateUser(
    @Req() req: { user: User },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAdminUserDto,
  ) {
    return this.platformAdminService.updateUser(req.user, id, body);
  }

  @Get('businesses')
  listBusinesses(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('onboarding') onboarding?: string,
  ) {
    return this.platformAdminService.listBusinesses(
      req.user,
      page,
      limit,
      search,
      onboarding,
    );
  }

  @Post('businesses')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  createBusiness(
    @Req() req: { user: User },
    @Body() body: CreateAdminBusinessDto,
  ) {
    return this.platformAdminService.createBusiness(req.user, body);
  }

  @Get('twilio/dashboard')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  getTwilioDashboard(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('sync') sync?: string,
  ) {
    return this.platformAdminService.getTwilioDashboard(req.user, {
      page,
      limit,
      sync: sync === '1' || sync === 'true',
    });
  }

  @Get('twilio/available-numbers')
  searchTwilioAvailableNumbers(
    @Req() req: { user: User },
    @Query() query: SearchAdminTwilioNumbersDto,
  ) {
    return this.platformAdminService.searchTwilioAvailableNumbers(
      req.user,
      query,
    );
  }

  @Post('twilio/phone-numbers/purchase')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  purchaseTwilioNumber(
    @Req() req: { user: User },
    @Body() body: PurchaseAdminTwilioNumberDto,
  ) {
    return this.platformAdminService.purchaseTwilioNumber(req.user, body);
  }

  @Post('twilio/webhook')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  setTwilioWebhook(
    @Req() req: { user: User },
    @Body() body: SetAdminTwilioWebhookDto,
  ) {
    return this.platformAdminService.setTwilioWebhook(req.user, body);
  }

  @Post('twilio/webhook/sync-all')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  syncAllTwilioWebhooks(@Req() req: { user: User }) {
    return this.platformAdminService.syncAllTwilioWebhooks(req.user);
  }

  @Post('twilio/phone-numbers/assign')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  assignTwilioNumber(
    @Req() req: { user: User },
    @Body() body: AssignAdminTwilioNumberDto,
  ) {
    return this.platformAdminService.assignTwilioNumber(req.user, body);
  }

  @Get('subscriptions')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  listSubscriptions(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    return this.platformAdminService.listSubscriptions(
      req.user,
      page,
      limit,
      search,
    );
  }

  @Get('subscription-plans')
  listSubscriptionPlans(@Req() req: { user: User }) {
    return this.platformAdminService.listSubscriptionPlans(req.user);
  }

  @Post('subscription-plans')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  createSubscriptionPlan(
    @Req() req: { user: User },
    @Body() body: CreateAdminPlanDto,
  ) {
    return this.platformAdminService.createSubscriptionPlan(req.user, body);
  }

  @Patch('subscription-plans/:id')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  updateSubscriptionPlan(
    @Req() req: { user: User },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminPlanDto,
  ) {
    return this.platformAdminService.updateSubscriptionPlan(
      req.user,
      id,
      body,
    );
  }

  @Get('notifications/unread-count')
  getNotificationsUnreadCount(@Req() req: { user: User }) {
    return this.platformAdminService.getNotificationsUnreadCount(req.user);
  }

  @Get('notifications')
  getNotifications(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status') statusRaw?: string,
  ) {
    const status =
      statusRaw?.trim().toLowerCase() === 'unread' ? 'unread' : 'read';
    return this.platformAdminService.getNotifications(
      req.user,
      page,
      limit,
      status,
    );
  }

  @Patch('notifications/read-all')
  markAllNotificationsRead(@Req() req: { user: User }) {
    return this.platformAdminService.markAllNotificationsRead(req.user);
  }

  @Patch('notifications/:id/read')
  markNotificationRead(
    @Req() req: { user: User },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.platformAdminService.markNotificationRead(req.user, id);
  }

  @Get('meeting-requests/summary')
  getMeetingRequestsSummary(@Req() req: { user: User }) {
    return this.platformAdminService.getMeetingRequestsSummary(req.user);
  }

  @Get('meeting-requests/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportMeetingRequests(
    @Req() req: { user: User },
    @Res() res: Response,
    @Query('scope') scopeRaw?: string,
    @Query('search') search?: string,
  ) {
    const normalized = scopeRaw?.trim().toLowerCase();
    const scope =
      normalized === 'upcoming' ||
      normalized === 'past' ||
      normalized === 'deal_won' ||
      normalized === 'all'
        ? normalized
        : 'all';
    const csv = await this.platformAdminService.exportMeetingRequestsCsv(
      req.user,
      scope,
      search,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="meeting-requests-${scope}.csv"`,
    );
    res.send(csv);
  }

  @Get('meeting-requests')
  getMeetingRequests(
    @Req() req: { user: User },
    @Query('scope') scopeRaw?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
    @Query('search') search?: string,
    @Query('sort') sortRaw?: string,
  ) {
    const normalized = scopeRaw?.trim().toLowerCase();
    const scope =
      normalized === 'upcoming' ||
      normalized === 'past' ||
      normalized === 'deal_won' ||
      normalized === 'all'
        ? normalized
        : 'all';
    const sort =
      sortRaw === 'meeting_desc' ||
      sortRaw === 'newest' ||
      sortRaw === 'oldest' ||
      sortRaw === 'meeting_asc'
        ? sortRaw
        : 'meeting_asc';
    return this.platformAdminService.getMeetingRequests(
      req.user,
      scope,
      page,
      limit,
      search,
      sort,
    );
  }
}
