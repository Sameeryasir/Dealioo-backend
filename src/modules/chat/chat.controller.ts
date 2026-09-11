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
  @Get('business/:businessId/unread')
  async getBusinessChatsUnread(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getBusinessChatsUnread(businessId, req.user.id);
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
  @Get('business/:businessId/conversation')
  async listBusinessConversations(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search: string | undefined,
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
      search,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/conversation/sync')
  async syncBusinessConversations(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('afterConversationId', ParseIntPipe) afterConversationId: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.syncBusinessChatCustomers(
      businessId,
      afterConversationId,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/messages/sync')
  async syncBusinessMessages(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Query('afterMessageId', ParseIntPipe) afterMessageId: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.syncBusinessChatMessages(
      businessId,
      afterMessageId,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/conversation/:conversationId/messages/sync')
  async syncConversationMessages(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Query('afterMessageId', ParseIntPipe) afterMessageId: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.syncConversationMessagesByConversationId(
      businessId,
      conversationId,
      afterMessageId,
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/conversation/:conversationId/messages')
  async getConversationMessages(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Query('beforeMessageId') beforeMessageIdRaw: string | undefined,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    const beforeMessageId = Number(beforeMessageIdRaw);
    return this.chatService.getConversationMessagesByConversationId(
      businessId,
      conversationId,
      {
        beforeMessageId:
          Number.isFinite(beforeMessageId) && beforeMessageId > 0
            ? beforeMessageId
            : undefined,
        limit,
      },
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/conversation/:conversationId')
  async getGuestConversation(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    return this.chatService.getGuestConversation(businessId, conversationId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/customers/:customerId/messages/sync')
  async syncCustomerConversationMessages(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('afterMessageId', ParseIntPipe) afterMessageId: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
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
      limit,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/customers/:customerId/messages')
  async getCustomerConversationMessages(
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('beforeMessageId') beforeMessageIdRaw: string | undefined,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Req() req: AuthRequest,
  ) {
    await this.redemptionService.verifyBusinessAccess(
      businessId,
      req.user.id,
      req.user.role.name,
    );

    const beforeMessageId = Number(beforeMessageIdRaw);
    return this.chatService.getCustomerConversationMessages(
      businessId,
      customerId,
      {
        beforeMessageId:
          Number.isFinite(beforeMessageId) && beforeMessageId > 0
            ? beforeMessageId
            : undefined,
        limit,
      },
    );
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
