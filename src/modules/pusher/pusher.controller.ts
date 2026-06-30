import {
  Controller,
  ForbiddenException,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
  Body,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { RedemptionService } from '../redemption/redemption.service';
import {
  parseRestaurantIdFromChatChannel,
  pusherRestaurantChatChannel,
} from './pusher.constants';
import { PusherService } from './pusher.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('pusher')
export class PusherController {
  constructor(
    private readonly pusherService: PusherService,
    private readonly redemptionService: RedemptionService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('auth')
  async authorizeChannel(
    @Body('socket_id') socketId: string,
    @Body('channel_name') channelName: string,
    @Req() req: AuthRequest,
  ) {
    if (!this.pusherService.isEnabled()) {
      throw new ServiceUnavailableException('Realtime messaging is not configured.');
    }

    const trimmedSocketId = socketId?.trim();
    const trimmedChannel = channelName?.trim();
    if (!trimmedSocketId || !trimmedChannel) {
      throw new ForbiddenException('Invalid Pusher auth request.');
    }

    const restaurantId = parseRestaurantIdFromChatChannel(trimmedChannel);
    if (restaurantId == null) {
      throw new ForbiddenException('Unsupported realtime channel.');
    }

    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    if (trimmedChannel !== pusherRestaurantChatChannel(restaurantId)) {
      throw new ForbiddenException('Unsupported realtime channel.');
    }

    return this.pusherService.authorizeChannel(trimmedSocketId, trimmedChannel);
  }
}
