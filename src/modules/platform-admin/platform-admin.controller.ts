import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '../../db/entities/user.entity';
import { PlatformAdminService } from './platform-admin.service';

@Controller('admin')
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('overview/trends')
  getTrends(
    @Req() req: { user: User },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.platformAdminService.getTrends(req.user, from, to);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('overview/kpis')
  getKpis(@Req() req: { user: User }) {
    return this.platformAdminService.getKpis(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('overview')
  getOverview(@Req() req: { user: User }) {
    return this.platformAdminService.getOverview(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('notifications/unread-count')
  getNotificationsUnreadCount(@Req() req: { user: User }) {
    return this.platformAdminService.getNotificationsUnreadCount(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
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

  @UseGuards(AuthGuard('jwt'))
  @Patch('notifications/read-all')
  markAllNotificationsRead(@Req() req: { user: User }) {
    return this.platformAdminService.markAllNotificationsRead(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('notifications/:id/read')
  markNotificationRead(
    @Req() req: { user: User },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.platformAdminService.markNotificationRead(req.user, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('meeting-requests')
  getMeetingRequests(@Req() req: { user: User }) {
    return this.platformAdminService.getMeetingRequests(req.user);
  }
}
