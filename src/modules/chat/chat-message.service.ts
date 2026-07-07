import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { Customer } from '../../db/entities/customer.entity';
import { Conversation } from '../../db/entities/conversation.entity';
import {
  ConversationMessage,
  ConversationMessageChannel,
  ConversationMessageDirection,
} from '../../db/entities/conversation-message.entity';
import { TwilioService } from '../sms/twilio.service';
import type { ConversationMessageDto } from './chat.dto';
import type { RecordOutboundMessageDto } from './chat-message.dto';
import {
  ChatMessageNotificationService,
  type ConversationSnapshot,
} from './chat-message-notification.service';
import { ChatService } from './chat.service';
import { truncateActivityMessagePreview } from '../../utils/truncate-activity-message';
import { stripEmailSignoffForChat } from '../../utils/strip-email-signoff-for-chat';

@Injectable()
export class ChatMessageService {
  private readonly logger = new Logger(ChatMessageService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(ConversationMessage)
    private readonly messageRepository: Repository<ConversationMessage>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    private readonly chatService: ChatService,
    private readonly chatMessageNotificationService: ChatMessageNotificationService,
    private readonly twilioService: TwilioService,
  ) {}

  async sendManualMessage(
    restaurantId: number,
    customerId: number,
    body: string,
    channel: ConversationMessageChannel = ConversationMessageChannel.SMS,
  ): Promise<ConversationMessageDto> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }

    const trimmed = body.trim();
    if (!trimmed) {
      throw new BadRequestException('Message cannot be empty.');
    }

    if (channel === ConversationMessageChannel.SMS) {
      if (!customer.phone?.trim()) {
        throw new BadRequestException(
          'This guest does not have a phone number on file.',
        );
      }

      await this.twilioService.sendSms(customer.phone, trimmed);
    }

    const idempotencyKey = `chat_message:manual:${restaurantId}:${customerId}:${randomUUID()}`;
    const savedMessageId = await this.persistOutboundMessage({
      restaurantId,
      customerId,
      channel,
      bodyPreview: trimmed,
      idempotencyKey,
      metadata: { source: 'manual_dashboard' },
    });

    if (!savedMessageId) {
      throw new BadRequestException('Could not save this message.');
    }

    const message = await this.messageRepository.findOne({
      where: { id: savedMessageId },
      relations: [
        'node',
        'sentByRestaurant',
        'sentByCustomer',
        'sentToRestaurant',
        'sentToCustomer',
      ],
    });

    if (!message) {
      throw new BadRequestException('Could not load the saved message.');
    }

    return this.chatService.mapStoredMessageToDto(message);
  }

  async recordOutboundMessage(params: RecordOutboundMessageDto): Promise<void> {
    const idempotencyKey = params.idempotencyKey.trim();
    if (!idempotencyKey) {
      return;
    }

    const existing = await this.messageRepository.findOne({
      where: { idempotencyKey },
      select: ['id'],
    });
    if (existing) {
      await this.chatMessageNotificationService.replayMessage(existing.id);
      return;
    }

    try {
      await this.persistOutboundMessage(params);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not save chat message';
      this.logger.warn(
        `recordOutboundMessage skipped for customer ${params.customerId}: ${message}`,
      );
    }
  }

  private async persistOutboundMessage(
    params: RecordOutboundMessageDto,
  ): Promise<number | null> {
    const idempotencyKey = params.idempotencyKey.trim();
    if (!idempotencyKey) {
      return null;
    }

    const body = stripEmailSignoffForChat(params.bodyPreview.trim()) || 'Message sent';
    const sentAt = params.sentAt ?? new Date();
    let savedMessageId: number | null = null;
    let conversationSnapshot: ConversationSnapshot | null = null;

    await this.dataSource.transaction(async (manager) => {
      let conversation = await manager.findOne(Conversation, {
        where: {
          restaurantId: params.restaurantId,
          customerId: params.customerId,
        },
      });

      if (!conversation) {
        conversation = await manager.save(
          manager.create(Conversation, {
            restaurantId: params.restaurantId,
            customerId: params.customerId,
            isPrivate: true,
            messageCount: 0,
          }),
        );
      }

      const savedMessage = await manager.save(
        manager.create(ConversationMessage, {
          conversationId: conversation.id,
          automationId: params.automationId ?? null,
          executionId: params.executionId ?? null,
          nodeId: params.nodeId ?? null,
          channel: params.channel,
          direction:
            params.direction ?? ConversationMessageDirection.OUTBOUND,
          sentByRestaurantId: params.restaurantId,
          sentByCustomerId: null,
          sentToRestaurantId: null,
          sentToCustomerId: params.customerId,
          body,
          metadata: params.metadata ?? null,
          sentAt,
          idempotencyKey,
        }),
      );
      savedMessageId = savedMessage.id;

      await manager.update(Conversation, conversation.id, {
        messageCount: conversation.messageCount + 1,
        lastMessagePreview: truncateActivityMessagePreview(body, 80),
        lastMessageChannel: params.channel,
        lastMessageAt: sentAt,
        lastAutomationId:
          params.automationId ?? conversation.lastAutomationId,
      });

      const updatedConversation = await manager.findOne(Conversation, {
        where: { id: conversation.id },
        relations: ['customer'],
      });

      if (updatedConversation) {
        conversationSnapshot = {
          messageCount: updatedConversation.messageCount,
          lastMessagePreview:
            updatedConversation.lastMessagePreview?.trim() || body,
          lastMessageChannel:
            updatedConversation.lastMessageChannel ?? params.channel,
          lastMessageAt: updatedConversation.lastMessageAt ?? sentAt,
          customerName: updatedConversation.customer?.name ?? null,
          customerEmail: updatedConversation.customer?.email ?? null,
        };
      }
    });

    if (savedMessageId && conversationSnapshot) {
      await this.chatMessageNotificationService.notifyMessageSent(
        savedMessageId,
        params.restaurantId,
        params.customerId,
        conversationSnapshot,
      );
    }

    return savedMessageId;
  }
}
