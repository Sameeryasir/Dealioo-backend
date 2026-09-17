import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessTwilioIntegration } from '../../db/entities/business-twilio-integration.entity';
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
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessTwilioIntegration)
    private readonly twilioIntegrationRepository: Repository<BusinessTwilioIntegration>,
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
    const normalizedTo = normalizePhoneNumber(params.toPhone?.trim() || '') || null;

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

    // Route by Twilio To number → business, then guest From → that business conversation.
    const businessId = await this.resolveBusinessIdByTwilioTo(normalizedTo);
    const customer = await this.findCustomerByPhone(normalizedFrom, businessId);
    if (!customer) {
      this.webhookLogger.warn(logContext, 'inbound.customer_not_found', {
        reason: InboundMessageSkipReason.CUSTOMER_NOT_FOUND,
        normalizedFrom,
        normalizedTo,
        businessId,
      });
      return { saved: false, skipReason: InboundMessageSkipReason.CUSTOMER_NOT_FOUND };
    }

    const conversation = await this.resolveConversation(customer.id, businessId);
    const targetBusinessId = conversation?.businessId ?? businessId ?? null;
    if (targetBusinessId == null) {
      this.webhookLogger.warn(logContext, 'inbound.conversation_not_found', {
        reason: InboundMessageSkipReason.CONVERSATION_NOT_FOUND,
        customerId: customer.id,
        normalizedTo,
      });
      return {
        saved: false,
        skipReason: InboundMessageSkipReason.CONVERSATION_NOT_FOUND,
        customerId: customer.id,
      };
    }

    try {
      const savedMessageId = await this.persistInboundMessage({
        businessId: targetBusinessId,
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
          twilioTo: normalizedTo,
          deliveryStatus: params.smsStatus ?? null,
        },
      });

      if (savedMessageId == null) {
        this.webhookLogger.warn(logContext, 'inbound.persist_failed', {
          reason: InboundMessageSkipReason.PERSIST_FAILED,
          customerId: customer.id,
          businessId: targetBusinessId,
        });
        return {
          saved: false,
          skipReason: InboundMessageSkipReason.PERSIST_FAILED,
          customerId: customer.id,
          businessId: targetBusinessId,
        };
      }

      this.webhookLogger.log(logContext, 'inbound.stored', {
        messageId: savedMessageId,
        customerId: customer.id,
        businessId: targetBusinessId,
        idempotencyKey,
      });

      return {
        saved: true,
        messageId: savedMessageId,
        customerId: customer.id,
        businessId: targetBusinessId,
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
            businessId: targetBusinessId,
          };
        }
      }

      const detail = error instanceof Error ? error.message : 'Unknown DB error';
      this.webhookLogger.error(logContext, 'inbound.database_error', {
        reason: InboundMessageSkipReason.DATABASE_ERROR,
        customerId: customer.id,
        businessId: targetBusinessId,
        error: detail,
      });
      return {
        saved: false,
        skipReason: InboundMessageSkipReason.DATABASE_ERROR,
        customerId: customer.id,
        businessId: targetBusinessId,
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

  private async resolveBusinessIdByTwilioTo(
    normalizedTo: string | null,
  ): Promise<number | null> {
    if (!normalizedTo) {
      return null;
    }

    const digits = phoneDigitsOnly(normalizedTo);
    if (!digits) {
      return null;
    }

    const business = await this.businessRepository
      .createQueryBuilder('business')
      .where(
        `regexp_replace(coalesce(business.twilio_phone_number, ''), '[^0-9]', '', 'g') = :digits`,
        { digits },
      )
      .orderBy('business.id', 'ASC')
      .getOne();
    if (business) {
      return business.id;
    }

    const integration = await this.twilioIntegrationRepository
      .createQueryBuilder('integration')
      .where(
        `regexp_replace(coalesce(integration.twilio_phone_number, ''), '[^0-9]', '', 'g') = :digits`,
        { digits },
      )
      .orderBy('integration.id', 'ASC')
      .getOne();

    return integration?.businessId ?? null;
  }

  private async resolveConversation(
    customerId: number,
    businessId: number | null,
  ): Promise<Conversation | null> {
    if (businessId != null) {
      return this.conversationRepository.findOne({
        where: { customerId, businessId, isPrivate: true },
      });
    }

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
    businessId: number | null,
  ): Promise<Customer | null> {
    const digits = phoneDigitsOnly(normalizedPhone);
    if (!digits) {
      return null;
    }

    if (businessId != null) {
      const linked = await this.customerRepository
        .createQueryBuilder('customer')
        .innerJoin('customer.businessCustomers', 'bc')
        .where('bc.business_id = :businessId', { businessId })
        .andWhere(
          `regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g') = :digits`,
          { digits },
        )
        .getMany();

      if (linked.length === 1) {
        return linked[0];
      }

      if (linked.length > 1) {
        const linkedIds = linked.map((customer) => customer.id);
        const conversation = await this.conversationRepository
          .createQueryBuilder('conversation')
          .where('conversation.business_id = :businessId', { businessId })
          .andWhere('conversation.customer_id IN (:...linkedIds)', { linkedIds })
          .andWhere('conversation.is_private = true')
          .orderBy('conversation.last_message_at', 'DESC', 'NULLS LAST')
          .getOne();

        if (conversation) {
          return (
            linked.find((customer) => customer.id === conversation.customerId) ??
            linked[0]
          );
        }
        return linked[0];
      }
    }

    const customers = await this.customerRepository
      .createQueryBuilder('customer')
      .where(
        `regexp_replace(coalesce(customer.phone, ''), '[^0-9]', '', 'g') = :digits`,
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
    const conversationQb = this.conversationRepository
      .createQueryBuilder('conversation')
      .where('conversation.customer_id IN (:...customerIds)', { customerIds })
      .andWhere('conversation.is_private = true');

    if (businessId != null) {
      conversationQb.andWhere('conversation.business_id = :businessId', {
        businessId,
      });
    }

    const conversation = await conversationQb
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
    businessId: number;
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
    let conversationId: number | null = null;
    let conversationSnapshot: ConversationSnapshot | null = null;

    await this.dataSource.transaction(async (manager) => {
      let conversation = await manager.findOne(Conversation, {
        where: {
          businessId: params.businessId,
          customerId: params.customerId,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!conversation) {
        try {
          conversation = await manager.save(
            manager.create(Conversation, {
              businessId: params.businessId,
              customerId: params.customerId,
              isPrivate: true,
              messageCount: 0,
            }),
          );
        } catch {
          conversation = await manager.findOne(Conversation, {
            where: {
              businessId: params.businessId,
              customerId: params.customerId,
            },
            lock: { mode: 'pessimistic_write' },
          });
        }
      }

      if (!conversation) {
        throw new Error(
          `Could not open conversation for business ${params.businessId} customer ${params.customerId}`,
        );
      }

      let createdNewMessage = false;
      try {
        const savedMessage = await manager.save(
          manager.create(ConversationMessage, {
            conversationId: conversation.id,
            automationId: null,
            executionId: null,
            nodeId: null,
            channel: params.channel,
            direction: ConversationMessageDirection.INBOUND,
            sentByBusinessId: null,
            sentByCustomerId: params.customerId,
            sentToBusinessId: params.businessId,
            sentToCustomerId: null,
            body: params.body,
            metadata: params.metadata ?? null,
            sentAt,
            idempotencyKey,
          }),
        );
        savedMessageId = savedMessage.id;
        createdNewMessage = true;
      } catch (error) {
        if (!this.isIdempotencyConflict(error)) {
          throw error;
        }
        const existing = await manager.findOne(ConversationMessage, {
          where: { idempotencyKey },
          select: ['id'],
        });
        if (!existing) {
          throw error;
        }
        savedMessageId = existing.id;
        createdNewMessage = false;
      }

      conversationId = conversation.id;

      if (createdNewMessage) {
        await manager
          .createQueryBuilder()
          .update(Conversation)
          .set({
            messageCount: () => '"message_count" + 1',
            lastMessagePreview: truncateActivityMessagePreview(params.body, 80),
            lastMessageChannel: params.channel,
            lastMessageAt: sentAt,
          })
          .where('id = :id', { id: conversation.id })
          .execute();
      }

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

    if (savedMessageId && conversationId && conversationSnapshot) {
      void this.chatMessageNotificationService.notifyMessageSent(
        savedMessageId,
        params.businessId,
        conversationId,
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
