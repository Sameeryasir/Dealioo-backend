import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { User } from '../../db/entities/user.entity';
import { BusinessTrackingService } from './business-tracking.service';
import { UpsertBusinessTrackingDto } from './dto/upsert-business-tracking.dto';

type AuthRequest = Request & { user: User };

@Controller('business-tracking')
export class BusinessTrackingController {
  constructor(
    private readonly businessTrackingService: BusinessTrackingService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get(':businessId')
  async getTracking(
    @Req() req: AuthRequest,
    @Param('businessId', ParseIntPipe) businessId: number,
  ) {
    return this.businessTrackingService.getForBusiness(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put(':businessId')
  async upsertTracking(
    @Req() req: AuthRequest,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() dto: UpsertBusinessTrackingDto,
  ) {
    return this.businessTrackingService.upsertForBusiness(
      req.user,
      businessId,
      dto,
    );
  }
}
