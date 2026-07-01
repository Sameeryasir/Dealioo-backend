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
import { PusherService } from '../pusher/pusher.service';
import { TwilioService } from '../sms/twilio.service';
import type { ConversationMessageDto } from './chat.dto';
import type { RecordInboundSmsMessageDto, RecordOutboundMessageDto } from './chat-message.dto';
import { ChatService } from './chat.service';
import { truncateActivityMessagePreview } from '../../utils/truncate-activity-message';
import {
  normalizePhoneNumber,
  phoneDigitsOnly,
} from '../sms/twilio.service';

type ConversationSnapshot = {
  messageCount: number;
  lastMessagePreview: string;
  lastMessageChannel: string;
  lastMessageAt: Date;
  customerName: string | null;
  customerEmail: string | null;
};

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
    private readonly pusherService: PusherService,
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
      await this.replayChatMessagePusher(existing.id);
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

  async recordInboundSmsMessage(
    params: RecordInboundSmsMessageDto,
  ): Promise<{ saved: boolean }> {
    const messageSid = params.messageSid.trim();
    const body = params.body.trim();
    const normalizedFrom = normalizePhoneNumber(params.fromPhone);

    if (!messageSid || !body || !normalizedFrom) {
      this.logger.warn('Twilio inbound SMS skipped: missing MessageSid, Body, or From.');
      return { saved: false };
    }

    const idempotencyKey = `chat_message:inbound:twilio:${messageSid}`;
    const existing = await this.messageRepository.findOne({
      where: { idempotencyKey },
      select: ['id'],
    });
    if (existing) {
      return { saved: true };
    }

    const customer = await this.findCustomerByPhone(normalizedFrom);
    if (!customer) {
      this.logger.warn(
        `Twilio inbound SMS skipped: no customer for phone ${normalizedFrom}.`,
      );
      return { saved: false };
    }

    const conversation = await this.conversationRepository.findOne({
      where: { customerId: customer.id, isPrivate: true },
      order: { lastMessageAt: 'DESC' },
    });
    if (!conversation) {
      this.logger.warn(
        `Twilio inbound SMS skipped: no conversation for customer ${customer.id}.`,
      );
      return { saved: false };
    }

    const savedMessageId = await this.persistInboundMessage({
      restaurantId: conversation.restaurantId,
      customerId: customer.id,
      body,
      idempotencyKey,
      metadata: {
        source: 'twilio_inbound',
        twilioMessageSid: messageSid,
        twilioFrom: normalizedFrom,
        twilioTo: params.toPhone?.trim() ?? null,
      },
    });

    return { saved: savedMessageId != null };
  }

  private async findCustomerByPhone(
    normalizedPhone: string,
  ): Promise<Customer | null> {
    const digits = phoneDigitsOnly(normalizedPhone);
    if (!digits) {
      return null;
    }

    const customers = await this.customerRepository
      .createQueryBuilder('customer')
      .where(
        "REGEXP_REPLACE(COALESCE(customer.phone, ''), '[^0-9]', '', 'g') = :digits",
        { digits },
      )
      .getMany();

    if (customers.length === 0) {
      return null;
    }

    if (customers.length === 1) {
      return customers[0];
    }

    const customerIds = customers.map((customer) => customer.id);
    const conversation = await this.conversationRepository
      .createQueryBuilder('conversation')
      .where('conversation.customer_id IN (:...customerIds)', { customerIds })
      .andWhere('conversation.is_private = true')
      .orderBy('conversation.last_message_at', 'DESC', 'NULLS LAST')
      .getOne();

    if (!conversation) {
      return customers[0];
    }

    return (
      customers.find((customer) => customer.id === conversation.customerId) ??
      customers[0]
    );
  }

  private async persistInboundMessage(params: {
    restaurantId: number;
    customerId: number;
    body: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<number | null> {
    const idempotencyKey = params.idempotencyKey.trim();
    if (!idempotencyKey) {
      return null;
    }

    const sentAt = new Date();
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
          automationId: null,
          executionId: null,
          nodeId: null,
          channel: ConversationMessageChannel.SMS,
          direction: ConversationMessageDirection.INBOUND,
          sentByRestaurantId: null,
          sentByCustomerId: params.customerId,
          sentToRestaurantId: params.restaurantId,
          sentToCustomerId: null,
          body: params.body,
          metadata: params.metadata ?? null,
          sentAt,
          idempotencyKey,
        }),
      );
      savedMessageId = savedMessage.id;

      await manager.update(Conversation, conversation.id, {
        messageCount: conversation.messageCount + 1,
        lastMessagePreview: truncateActivityMessagePreview(params.body, 80),
        lastMessageChannel: ConversationMessageChannel.SMS,
        lastMessageAt: sentAt,
      });

      const updatedConversation = await manager.findOne(Conversation, {
        where: { id: conversation.id },
        relations: ['customer'],
      });

      if (updatedConversation) {
        conversationSnapshot = {
          messageCount: updatedConversation.messageCount,
          lastMessagePreview:
            updatedConversation.lastMessagePreview?.trim() || params.body,
          lastMessageChannel:
            updatedConversation.lastMessageChannel ??
            ConversationMessageChannel.SMS,
          lastMessageAt: updatedConversation.lastMessageAt ?? sentAt,
          customerName: updatedConversation.customer?.name ?? null,
          customerEmail: updatedConversation.customer?.email ?? null,
        };
      }
    });

    if (savedMessageId && conversationSnapshot) {
      await this.notifyChatMessagePusher(
        savedMessageId,
        params.restaurantId,
        params.customerId,
        conversationSnapshot,
      );
    }

    this.logger.log(
      `Twilio inbound SMS saved for customer ${params.customerId} at restaurant ${params.restaurantId}.`,
    );

    return savedMessageId;
  }

  private async persistOutboundMessage(
    params: RecordOutboundMessageDto,
  ): Promise<number | null> {
    const idempotencyKey = params.idempotencyKey.trim();
    if (!idempotencyKey) {
      return null;
    }

    const body = params.bodyPreview.trim() || 'Message sent';
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
      await this.notifyChatMessagePusher(
        savedMessageId,
        params.restaurantId,
        params.customerId,
        conversationSnapshot,
      );
    }

    return savedMessageId;
  }

  private async replayChatMessagePusher(messageId: number): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: ['conversation', 'conversation.customer'],
    });

    if (!message?.conversation) {
      return;
    }

    const conversation = message.conversation;

    await this.notifyChatMessagePusher(
      message.id,
      conversation.restaurantId,
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

  private async notifyChatMessagePusher(
    messageId: number,
    restaurantId: number,
    customerId: number,
    conversationSnapshot: ConversationSnapshot,
  ): Promise<void> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
      relations: [
        'node',
        'sentByRestaurant',
        'sentByCustomer',
        'sentToRestaurant',
        'sentToCustomer',
      ],
    });

    if (!message) {
      return;
    }

    const messageDto = this.chatService.mapStoredMessageToDto(message);

    await this.pusherService.notifyChatMessageSent({
      restaurantId,
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
