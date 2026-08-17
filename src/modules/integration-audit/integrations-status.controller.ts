import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { User } from '../../db/entities/user.entity';
import type { IntegrationsStatusDto } from './dto/integrations-status.dto';
import { IntegrationsStatusService } from './integrations-status.service';

type AuthRequest = Request & { user: User };

@Controller('integrations')
export class IntegrationsStatusController {
  constructor(
    private readonly integrationsStatusService: IntegrationsStatusService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('status/:businessId')
  async status(
    @Req() req: AuthRequest,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<IntegrationsStatusDto> {
    return this.integrationsStatusService.getStatus(req.user, businessId);
  }
}
