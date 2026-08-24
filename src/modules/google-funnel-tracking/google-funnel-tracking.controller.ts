import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { TrackGoogleFunnelEventDto } from './dto/track-google-funnel-event.dto';
import { GoogleFunnelTrackingService } from './google-funnel-tracking.service';

@Controller('google-funnel-tracking')
export class GoogleFunnelTrackingController {
  constructor(
    private readonly trackingService: GoogleFunnelTrackingService,
  ) {}

  @SkipThrottle()
  @Post('events')
  @HttpCode(200)
  async track(@Body() dto: TrackGoogleFunnelEventDto, @Req() req: Request) {
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
