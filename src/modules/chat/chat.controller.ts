import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { RedemptionService } from '../redemption/redemption.service';
import { ChatMessageService } from './chat-message.service';
import { ChatService } from './chat.service';
import { SendCustomerMessageDto } from './send-customer-message.dto';

type AuthRequest = Request & {
  user: { id: number; email: string; role: { id: number; name: string } };
};

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatMessageService: ChatMessageService,
    private readonly redemptionService: RedemptionService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/unread-summary')
  async getChatUnreadSummary(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getChatUnreadSummary(restaurantId, req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('restaurant/:restaurantId/mark-read')
  async markRestaurantChatsRead(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    const chatsLastViewedAt = await this.chatService.markRestaurantChatsRead(
      restaurantId,
      req.user.id,
    );

    return { chatsLastViewedAt };
  }

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

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/customers')
  async getRestaurantChatCustomers(
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

    return this.chatService.getRestaurantChatCustomers(
      restaurantId,
      page,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/customers/sync')
  async syncRestaurantChatCustomers(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Query('afterCustomerId', ParseIntPipe) afterCustomerId: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.syncRestaurantChatCustomers(
      restaurantId,
      afterCustomerId,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/customers/:customerId/messages/sync')
  async syncCustomerConversationMessages(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('afterMessageId', ParseIntPipe) afterMessageId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.syncCustomerConversationMessages(
      restaurantId,
      customerId,
      afterMessageId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:restaurantId/customers/:customerId/messages')
  async getCustomerConversation(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getCustomerConversation(restaurantId, customerId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('restaurant/:restaurantId/customers/:customerId/messages')
  async sendCustomerMessage(
    @Param('restaurantId', ParseIntPipe) restaurantId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: SendCustomerMessageDto,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyRestaurantAccess(
      restaurantId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatMessageService.sendManualMessage(
      restaurantId,
      customerId,
      dto.body,
      dto.channel,
    );
  }
}
