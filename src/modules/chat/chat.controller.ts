import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { RedemptionService } from '../redemption/redemption.service';
import { ChatService } from './chat.service';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly redemptionService: RedemptionService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/active-flows')
  async getActiveFlowCustomers(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getActiveFlowCustomers(restaurantId, page, limit);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/conversations/:executionId')
  async getConversation(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Param('executionId', ParseIntPipe) executionId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getConversation(restaurantId, executionId);
  }
}
