import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationMessage } from '../../db/entities/conversation-message.entity';
import { PusherService } from '../pusher/pusher.service';
import { ChatService } from './chat.service';

export type ConversationSnapshot = {
  messageCount: number;
  lastMessagePreview: string;
  lastMessageChannel: string;
  lastMessageAt: Date;
  customerName: string | null;
  customerEmail: string | null;
};

@Injectable()
export class ChatMessageNotificationService {
  constructor(
    @InjectRepository(ConversationMessage)
    private readonly messageRepository: Repository<ConversationMessage>,
    private readonly chatService: ChatService,
    private readonly pusherService: PusherService,
  ) {}

  async replayMessage(messageId: number): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['conversation', 'conversation.customer'],
    });

    if (!message?.conversation) {
      return;
    }

    const conversation = message.conversation;

    await this.notifyMessageSent(
      message.id,
      conversation.businessId,
      conversation.id,
      conversation.customerId,
      {
        messageCount: conversation.messageCount,
        lastMessagePreview:
          conversation.lastMessagePreview?.trim() || message.body.trim(),
        lastMessageChannel:
          conversation.lastMessageChannel ?? message.channel,
        lastMessageAt: conversation.lastMessageAt ?? message.sentAt,
        customerName: conversation.customer?.name ?? null,
        customerEmail: conversation.customer?.email ?? null,
      },
    );
  }

  async notifyMessageSent(
    messageId: number,
    businessId: number,
    conversationId: number,
    customerId: number,
    conversationSnapshot: ConversationSnapshot,
  ): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: [
        'node',
        'sentByBusiness',
        'sentByCustomer',
        'sentToBusiness',
        'sentToCustomer',
      ],
    });

    if (!message) {
      return;
    }

    const resolvedConversationId =
      Number.isFinite(conversationId) && conversationId > 0
        ? conversationId
        : message.conversationId;

    if (
      !Number.isFinite(resolvedConversationId) ||
      resolvedConversationId < 1
    ) {
      return;
    }

    const messageDto = this.chatService.mapStoredMessageToDto(message);

    await this.pusherService.notifyChatMessageSent({
      businessId,
      conversationId: resolvedConversationId,
      customerId,
      customerName: conversationSnapshot.customerName,
      customerEmail: conversationSnapshot.customerEmail,
      message: {
        ...messageDto,
        sentAt: message.sentAt.toISOString(),
      },
      lastMessagePreview: conversationSnapshot.lastMessagePreview,
      lastMessageChannel: this.chatService.resolveChannelMessageKind(
        conversationSnapshot.lastMessageChannel,
      ),
      lastMessageAt: conversationSnapshot.lastMessageAt.toISOString(),
      messageCount: conversationSnapshot.messageCount,
    });
  }
}
