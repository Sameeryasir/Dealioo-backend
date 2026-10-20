import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { User } from '../../db/entities/user.entity';
import { CreateAdminBusinessDto } from './dto/create-admin-business.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';
import { PlatformAdminService } from './platform-admin.service';
import { SuperAdminGuard } from './super-admin.guard';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get('overview/trends')
  getTrends(
    @Req() req: { user: User },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('timezone') timeZone?: string,
  ) {
    return this.platformAdminService.getTrends(req.user, from, to, timeZone);
  }

  @Get('overview/dashboard')
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

  @Get('overview/kpis')
  getKpis(@Req() req: { user: User }) {
    return this.platformAdminService.getKpis(req.user);
  }

  @Get('overview')
  getOverview(@Req() req: { user: User }) {
    return this.platformAdminService.getOverview(req.user);
  }

  @Get('users')
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

  @Get('meeting-requests')
  getMeetingRequests(@Req() req: { user: User }) {
    return this.platformAdminService.getMeetingRequests(req.user);
  }
}
