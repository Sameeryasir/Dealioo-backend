import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ClaimFacebookAttributionDto } from './dto/claim-facebook-attribution.dto';
import { TrackProductMetaEventDto } from './dto/track-product-meta-event.dto';
import { ProductMetaTrackingService } from './product-meta-tracking.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('product-meta-tracking')
export class ProductMetaTrackingController {
  constructor(private readonly trackingService: ProductMetaTrackingService) {}

  @SkipThrottle()
  @Post('events')
  @HttpCode(200)
  async track(@Body() dto: TrackProductMetaEventDto, @Req() req: Request) {
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

  @UseGuards(AuthGuard('jwt'))
  @Post('attribution/claim')
  @HttpCode(200)
  async claimAttribution(
    @Body() dto: ClaimFacebookAttributionDto,
    @Req() req: AuthRequest,
  ) {
    return this.trackingService.claimAttribution(req.user.id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('attribution')
  async getAttribution(@Req() req: AuthRequest) {
    return this.trackingService.getAttribution(req.user.id);
  }
}
