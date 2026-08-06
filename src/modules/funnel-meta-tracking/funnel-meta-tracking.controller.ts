import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { TrackFunnelMetaEventDto } from './dto/track-funnel-meta-event.dto';
import { FunnelMetaTrackingService } from './funnel-meta-tracking.service';

@Controller('funnel-meta-tracking')
export class FunnelMetaTrackingController {
  constructor(private readonly trackingService: FunnelMetaTrackingService) {}

  @SkipThrottle()
  @Post('events')
  @HttpCode(200)
  async track(@Body() dto: TrackFunnelMetaEventDto, @Req() req: Request) {
    const forwarded = req.headers['x-forwarded-for'];
    const forwardedIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : Array.isArray(forwarded)
          ? forwarded[0]?.trim()
          : undefined;

    return this.trackingService.ingest(dto, {
      ip: forwardedIp || req.ip,
      userAgent:
        typeof req.headers['user-agent'] === 'string'
          ? req.headers['user-agent']
          : undefined,
    });
  }
}
