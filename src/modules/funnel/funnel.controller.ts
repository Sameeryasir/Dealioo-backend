import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { Funnel } from '../../db/entities/funnel.entity';
import { RedemptionService } from '../redemption/redemption.service';
import { CreateFunnelDto } from './funnelDto/create-funnel.dto';
import { RestaurantFunnelSummary } from './funnelDto/restaurant-funnel-summary.dto';
import { UpdateFunnelDto } from './funnelDto/update-funnel.dto';
import { FunnelService } from './funnel.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('funnel')
export class FunnelController {
  constructor(
    private readonly funnelService: FunnelService,
    private readonly redemptionService: RedemptionService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  createFunnel(@Body() dto: CreateFunnelDto, @Req() req): Promise<Funnel> {
    return this.funnelService.createOrUpdateFunnel(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId')
  async getFunnelsByRestaurant(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Req() req: AuthRequest,
  ): Promise<RestaurantFunnelSummary[]> {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.funnelService.getFunnelsByRestaurantId(restaurantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('campaign/:campaignId/summary')
  async getFunnelSummaryByCampaign(
    @Req() req: AuthRequest,
    @Param('campaignId', ParseIntPipe) campaignId: number,
  ): Promise<{ id: number }> {
    const funnel = await this.funnelService.getFunnelSummaryByCampaignId(
      campaignId,
      req.user,
    );
    if (!funnel) {
      throw new NotFoundException('No funnel found for this campaign.');
    }
    return funnel;
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('campaign/:campaignId')
  async getFunnelByCampaign(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Param('campaignId', ParseIntPipe) campaignId: number,
  ): Promise<Funnel | undefined> {
    const meta = await this.funnelService.getFunnelMetaByCampaignId(
      campaignId,
      req.user,
    );
    if (!meta) {
      throw new NotFoundException('No funnel found for this campaign.');
    }

    const etag = `"funnel-${meta.id}-v${meta.version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');

    if (ifNoneMatch === etag) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    const funnel = await this.funnelService.getFunnelBodyByCampaignId(
      campaignId,
    );
    if (!funnel) {
      throw new NotFoundException('No funnel found for this campaign.');
    }

    return funnel;
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  getFunnelById(@Param('id', ParseIntPipe) id: number): Promise<Funnel> {
    return this.funnelService.getFunnelById(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put(':id')
  updateFunnel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFunnelDto,
    @Req() req,
  ): Promise<Funnel> {
    return this.funnelService.updateFunnel(id, dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  deleteFunnel(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<void> {
    return this.funnelService.deleteFunnel(id, req.user);
  }
}
