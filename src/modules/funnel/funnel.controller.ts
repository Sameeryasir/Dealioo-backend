import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Funnel } from '../../db/entities/funnel.entity';
import { CreateFunnelDto } from './funnelDto/create-funnel.dto';
import { UpdateFunnelDto } from './funnelDto/update-funnel.dto';
import { FunnelService } from './funnel.service';

@Controller('funnel')
export class FunnelController {
  constructor(private readonly funnelService: FunnelService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  createFunnel(@Body() dto: CreateFunnelDto, @Req() req): Promise<Funnel> {
    return this.funnelService.createFunnel(dto, req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('campaign/:campaignId')
  getFunnelsByCampaign(
    @Param('campaignId', ParseIntPipe) campaignId: number,
  ): Promise<Funnel[]> {
    return this.funnelService.getFunnelsByCampaignId(campaignId);
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
