import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { SidebarUnreadSection } from '../../db/entities/business-user-sidebar-section-read-state.entity';
import { isSidebarUnreadSection } from './sidebar-unread.constants';
import { SidebarUnreadService } from './sidebar-unread.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('sidebar-unread')
export class SidebarUnreadController {
  constructor(private readonly sidebarUnreadService: SidebarUnreadService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId')
  async getBusinessUnread(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Req() req: AuthRequest,
  ) {
    await this.sidebarUnreadService.assertBusinessAccess(req.user, businessId);

    const allowed: SidebarUnreadSection[] = [];
    try {
      await this.sidebarUnreadService.assertCanAccessSection(
        req.user,
        businessId,
        'orders',
      );
      allowed.push('orders');
    } catch {
    }
    try {
      await this.sidebarUnreadService.assertCanAccessSection(
        req.user,
        businessId,
        'activity',
      );
      allowed.push('activity');
    } catch {
    }
    try {
      await this.sidebarUnreadService.assertCanAccessSection(
        req.user,
        businessId,
        'history',
      );
      allowed.push('history');
    } catch {
    }

    return this.sidebarUnreadService.getBusinessUnread(
      businessId,
      req.user.id,
      allowed,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/:section')
  async getSectionUnread(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('section') sectionParam: string,
    @Req() req: AuthRequest,
  ) {
    const section = this.parseSection(sectionParam);
    await this.sidebarUnreadService.assertCanAccessSection(
      req.user,
      businessId,
      section,
    );
    return this.sidebarUnreadService.getSectionUnread(
      businessId,
      req.user.id,
      section,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/access-notify/mark-read')
  async markAccessNotifyRead(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Req() req: AuthRequest,
  ) {
    await this.sidebarUnreadService.assertBusinessAccess(req.user, businessId);
    await this.sidebarUnreadService.markAccessNotifyRead(
      businessId,
      req.user.id,
    );
    return { cleared: true };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/:section/mark-read')
  async markSectionRead(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('section') sectionParam: string,
    @Req() req: AuthRequest,
  ) {
    const section = this.parseSection(sectionParam);
    await this.sidebarUnreadService.assertCanAccessSection(
      req.user,
      businessId,
      section,
    );
    const lastViewedAt = await this.sidebarUnreadService.markSectionRead(
      businessId,
      req.user.id,
      section,
    );
    return { section, lastViewedAt: lastViewedAt.toISOString() };
  }

  private parseSection(value: string): SidebarUnreadSection {
    const trimmed = value?.trim().toLowerCase() ?? '';
    if (!isSidebarUnreadSection(trimmed)) {
      throw new BadRequestException(
        'Section must be one of: orders, activity, history.',
      );
    }
    return trimmed;
  }
}
