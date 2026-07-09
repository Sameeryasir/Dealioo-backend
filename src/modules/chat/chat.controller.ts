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
  @Get('business/:businessId/unread-summary')
  async getChatUnreadSummary(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getChatUnreadSummary(businessId, req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/mark-read')
  async markBusinessChatsRead(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    const chatsLastViewedAt = await this.chatService.markBusinessChatsRead(
      businessId,
      req.user.id,
    );

    return { chatsLastViewedAt };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/active-flows')
  async getActiveFlowCustomers(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getActiveFlowCustomers(businessId, page, limit);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/conversations/:executionId')
  async getConversation(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('executionId', ParseIntPipe) executionId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getConversation(businessId, executionId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/customers')
  async getBusinessChatCustomers(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getBusinessChatCustomers(
      businessId,
      page,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/customers/sync')
  async syncBusinessChatCustomers(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('afterCustomerId', ParseIntPipe) afterCustomerId: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.syncBusinessChatCustomers(
      businessId,
      afterCustomerId,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/customers/:customerId/messages/sync')
  async syncCustomerConversationMessages(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('afterMessageId', ParseIntPipe) afterMessageId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.syncCustomerConversationMessages(
      businessId,
      customerId,
      afterMessageId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/customers/:customerId/messages')
  async getCustomerConversation(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getCustomerConversation(businessId, customerId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/customers/:customerId/messages')
  async sendCustomerMessage(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: SendCustomerMessageDto,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatMessageService.sendManualMessage(
      businessId,
      customerId,
      dto.body,
      dto.channel,
    );
  }
}
