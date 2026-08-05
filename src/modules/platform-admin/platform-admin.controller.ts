import { Controller, Get, Req, UseGuards } from '@nestjs/common';
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
}
