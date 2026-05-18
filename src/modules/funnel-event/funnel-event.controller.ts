import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { TrackFunnelEventDto } from './funnelEventDto/track-funnel-event.dto';
import { FunnelEventService } from './funnel-event.service';

@Controller('funnel-event')
export class FunnelEventController {
  constructor(private readonly funnelEventService: FunnelEventService) {}

  @SkipThrottle()
  @Post('track')
  @HttpCode(200)
  track(@Body() dto: TrackFunnelEventDto): Promise<FunnelEvent> {
    return this.funnelEventService.track(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('funnel/:funnelId/stats')
  getStats(@Param('funnelId', ParseIntPipe) funnelId: number) {
    return this.funnelEventService.getStats(funnelId);
  }
}
