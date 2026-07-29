import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '../../db/entities/user.entity';
import { AiConversationService } from './ai-conversation.service';
import { AiMessageService } from './ai-message.service';
import { CreateAiConversationDto } from './dto/create-ai-conversation.dto';
import { CreateAiMessageDto } from './dto/create-ai-message.dto';

@Controller('ai/conversations')
@UseGuards(AuthGuard('jwt'))
export class AiConversationController {
  constructor(
    private readonly conversationService: AiConversationService,
    private readonly messageService: AiMessageService,
  ) {}

  @Post()
  async create(
    @Body() dto: CreateAiConversationDto,
    @Req() req: { user: User },
  ) {
    const conversation = await this.conversationService.create(
      dto,
      req.user,
    );

    return {
      id: conversation.id,
      title: conversation.title,
      businessId: conversation.businessId,
      funnelId: conversation.funnelId,
      createdAt: conversation.createdAt,
    };
  }

  @Get('funnel/:funnelId')
  async findByFunnelId(
    @Param('funnelId', ParseIntPipe) funnelId: number,
  ) {
    return this.conversationService.findByFunnelId(funnelId);
  }

  @Delete(':conversationId')
  async remove(@Param('conversationId') conversationId: string) {
    await this.conversationService.remove(conversationId);
    return { success: true };
  }

  @Get(':conversationId/messages/after')
  async findMessagesAfter(
    @Param('conversationId') conversationId: string,
    @Query('lastMessageId') lastMessageId: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.messageService.findMessages(
      conversationId,
      lastMessageId,
      limit,
    );
  }

  @Get(':conversationId/messages/before')
  async findMessagesBefore(
    @Param('conversationId') conversationId: string,
    @Query('lastMessageId') lastMessageId: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.messageService.findMessages(
      conversationId,
      lastMessageId,
      limit,
    );
  }

  @Get(':conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.messageService.findByConversation(
      conversationId,
      page,
      limit,
    );
  }

  @Post(':conversationId/messages')
  async createMessage(
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateAiMessageDto,
  ) {
    const { message, conversationTitle } = await this.messageService.create(
      conversationId,
      dto,
    );

    return {
      ...message,
      conversationTitle,
    };
  }
}
