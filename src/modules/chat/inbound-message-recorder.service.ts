import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Customer } from '../../db/entities/customer.entity';
import { Conversation } from '../../db/entities/conversation.entity';
import {
  ConversationMessage,
  ConversationMessageChannel,
  ConversationMessageDirection,
} from '../../db/entities/conversation-message.entity';
import { truncateActivityMessagePreview } from '../../utils/truncate-activity-message';
import { buildInboundIdempotencyKey } from '../sms/utils/inbound-idempotency.util';
import { MessagingWebhookLogger } from '../sms/utils/messaging-webhook.logger';
import {
  InboundMessageSkipReason,
  MessagingProvider,
  type InboundMessageRecordResult,
  type MessagingCorrelationContext,
} from '../sms/types/inbound-messaging.types';
import type { RecordInboundSmsDto } from '../sms/dto/record-inbound-sms.dto';
import {
  normalizePhoneNumber,
  phoneDigitsOnly,
} from '../sms/twilio.service';
import {
  ChatMessageNotificationService,
  type ConversationSnapshot,
} from './chat-message-notification.service';

@Injectable()
export class InboundMessageRecorderService {
  private readonly logger = new Logger(InboundMessageRecorderService.name);
  private readonly webhookLogger = new MessagingWebhookLogger(this.logger);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(ConversationMessage)
    private readonly messageRepository: Repository<ConversationMessage>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    private readonly chatMessageNotificationService: ChatMessageNotificationService,
  ) {}

  async recordInboundSms(
    params: RecordInboundSmsDto,
  ): Promise<InboundMessageRecordResult> {
    const provider = params.context?.provider ?? MessagingProvider.TWILIO;
    const channel = params.context?.channel ?? ConversationMessageChannel.SMS;
    const logContext: MessagingCorrelationContext = {
      correlationId: params.correlationId,
      provider,
      channel,
      externalMessageId: params.messageSid,
    };

    const messageSid = params.messageSid.trim();
    const body = params.body.trim();
    const normalizedFrom = normalizePhoneNumber(params.fromPhone);

    if (!messageSid || !body || !normalizedFrom) {
      this.webhookLogger.warn(logContext, 'inbound.validation_failed', {
        reason: InboundMessageSkipReason.MISSING_FIELDS,
        fromPhone: params.fromPhone?.trim() || null,
      });
      return { saved: false, skipReason: InboundMessageSkipReason.MISSING_FIELDS };
    }

    const idempotencyKey = buildInboundIdempotencyKey(provider, messageSid);
    const duplicate = await this.findExistingInboundMessage(idempotencyKey);
    if (duplicate) {
      this.webhookLogger.log(logContext, 'inbound.duplicate', {
        messageId: duplicate.id,
        idempotencyKey,
      });
      return {
        saved: true,
        duplicate: true,
        messageId: duplicate.id,
      };
    }

    const customer = await this.findCustomerByPhone(normalizedFrom);
    if (!customer) {
      this.webhookLogger.warn(logContext, 'inbound.customer_not_found', {
        reason: InboundMessageSkipReason.CUSTOMER_NOT_FOUND,
        normalizedFrom,
      });
      return { saved: false, skipReason: InboundMessageSkipReason.CUSTOMER_NOT_FOUND };
    }

    const conversation = await this.resolveConversation(customer.id);
    if (!conversation) {
      this.webhookLogger.warn(logContext, 'inbound.conversation_not_found', {
        reason: InboundMessageSkipReason.CONVERSATION_NOT_FOUND,
        customerId: customer.id,
      });
      return {
        saved: false,
        skipReason: InboundMessageSkipReason.CONVERSATION_NOT_FOUND,
        customerId: customer.id,
      };
    }

    try {
      const savedMessageId = await this.persistInboundMessage({
        restaurantId: conversation.restaurantId,
        customerId: customer.id,
        body,
        channel,
        idempotencyKey,
        metadata: {
          source: `${provider}_inbound`,
          provider,
          correlationId: params.correlationId,
          twilioMessageSid: messageSid,
          twilioFrom: normalizedFrom,
          twilioTo: params.toPhone?.trim() ?? null,
          deliveryStatus: params.smsStatus ?? null,
        },
      });

      if (savedMessageId == null) {
        this.webhookLogger.warn(logContext, 'inbound.persist_failed', {
          reason: InboundMessageSkipReason.PERSIST_FAILED,
          customerId: customer.id,
          restaurantId: conversation.restaurantId,
        });
        return {
          saved: false,
          skipReason: InboundMessageSkipReason.PERSIST_FAILED,
          customerId: customer.id,
          restaurantId: conversation.restaurantId,
        };
      }

      this.webhookLogger.log(logContext, 'inbound.stored', {
        messageId: savedMessageId,
        customerId: customer.id,
        restaurantId: conversation.restaurantId,
        idempotencyKey,
      });

      return {
        saved: true,
        messageId: savedMessageId,
        customerId: customer.id,
        restaurantId: conversation.restaurantId,
      };
    } catch (error) {
      if (this.isIdempotencyConflict(error)) {
        const existing = await this.findExistingInboundMessage(idempotencyKey);
        if (existing) {
          this.webhookLogger.log(logContext, 'inbound.duplicate_race', {
            messageId: existing.id,
            idempotencyKey,
          });
          return {
            saved: true,
            duplicate: true,
            messageId: existing.id,
            customerId: customer.id,
            restaurantId: conversation.restaurantId,
          };
        }
      }

      const detail = error instanceof Error ? error.message : 'Unknown DB error';
      this.webhookLogger.error(logContext, 'inbound.database_error', {
        reason: InboundMessageSkipReason.DATABASE_ERROR,
        customerId: customer.id,
        restaurantId: conversation.restaurantId,
        error: detail,
      });
      return {
        saved: false,
        skipReason: InboundMessageSkipReason.DATABASE_ERROR,
        customerId: customer.id,
        restaurantId: conversation.restaurantId,
      };
    }
  }

  private async findExistingInboundMessage(
    idempotencyKey: string,
  ): Promise<ConversationMessage | null> {
    return this.messageRepository.findOne({
      where: { idempotencyKey },
      select: ['id'],
    });
  }

  private async resolveConversation(
    customerId: number,
  ): Promise<Conversation | null> {
    let conversation = await this.conversationRepository.findOne({
      where: { customerId, isPrivate: true },
      order: { lastMessageAt: 'DESC' },
    });

    if (conversation) {
      return conversation;
    }

    const recentSmsThread = await this.messageRepository
      .createQueryBuilder('message')
      .innerJoinAndSelect('message.conversation', 'conversation')
      .where('conversation.customer_id = :customerId', { customerId })
      .andWhere('message.channel = :channel', {
        channel: ConversationMessageChannel.SMS,
      })
      .orderBy('message.sent_at', 'DESC')
      .getOne();

    return recentSmsThread?.conversation ?? null;
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
    channel: ConversationMessageChannel;
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
          channel: params.channel,
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
        lastMessageChannel: params.channel,
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

  private isIdempotencyConflict(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as { code?: string; constraint?: string };
    return (
      driverError.code === '23505' &&
      driverError.constraint === 'UQ_conversation_message_idempotency_key'
    );
  }
}
