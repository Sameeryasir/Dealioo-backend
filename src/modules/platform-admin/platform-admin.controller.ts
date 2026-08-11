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
  @Get('overview')
  getOverview(@Req() req: { user: User }) {
    return this.platformAdminService.getOverview(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('notifications')
  getNotifications(
    @Req() req: { user: User },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('status') statusRaw?: string,
  ) {
    // All tab = latest read. Unread tab = latest unread.
    const status =
      statusRaw?.trim().toLowerCase() === 'unread' ? 'unread' : 'read';
    return this.platformAdminService.getNotifications(
      req.user,
      page,
      limit,
      status,
    );
  }

  // --- Mark all as read ---
  // Must stay above :id/read so "read-all" is never treated as an id.
  @UseGuards(AuthGuard('jwt'))
  @Patch('notifications/read-all')
  markAllNotificationsRead(@Req() req: { user: User }) {
    return this.platformAdminService.markAllNotificationsRead(req.user);
  }

  // --- Mark one as read ---
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
