import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
} from '../../common/pagination';
import {
  ActivityEvent,
  ActivityEventType,
} from '../../db/entities/activity-event.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { Conversation } from '../../db/entities/conversation.entity';
import {
  ConversationMessage,
  ConversationMessageChannel,
  ConversationMessageDirection as StoredMessageDirection,
} from '../../db/entities/conversation-message.entity';
import { RestaurantUserChatReadState } from '../../db/entities/restaurant-user-chat-read-state.entity';
import {
  ActiveFlowCustomerDto,
  ChatCustomerSummaryDto,
  ChatUnreadSummaryDto,
  ConversationDetailDto,
  ConversationMessageDirection,
  ConversationMessageDto,
  ConversationMessageKind,
  ConversationMessageParticipantDto,
  CustomerConversationDetailDto,
  PaginatedActiveFlowCustomersDto,
  PaginatedChatCustomersDto,
  SyncChatCustomersDto,
} from './chat.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(AutomationExecution)
    private readonly executionRepository: Repository<AutomationExecution>,
    @InjectRepository(AutomationLog)
    private readonly logRepository: Repository<AutomationLog>,
    @InjectRepository(ActivityEvent)
    private readonly activityRepository: Repository<ActivityEvent>,
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly messageRepository: Repository<ConversationMessage>,
    @InjectRepository(RestaurantUserChatReadState)
    private readonly chatReadStateRepository: Repository<RestaurantUserChatReadState>,
  ) {}

  async getChatUnreadSummary(
    restaurantId: number,
    userId: number,
  ): Promise<ChatUnreadSummaryDto> {
    const readState = await this.chatReadStateRepository.findOne({
      where: { restaurantId, userId },
    });

    const unreadCount = await this.countUnreadInboundMessages(
      restaurantId,
      readState?.chatsLastViewedAt ?? null,
    );

    return {
      hasUnread: unreadCount > 0,
      unreadCount,
      chatsLastViewedAt: readState?.chatsLastViewedAt ?? null,
    };
  }

  async markRestaurantChatsRead(
    restaurantId: number,
    userId: number,
  ): Promise<Date> {
    const viewedAt = new Date();
    const existing = await this.chatReadStateRepository.findOne({
      where: { restaurantId, userId },
    });

    if (existing) {
      existing.chatsLastViewedAt = viewedAt;
      await this.chatReadStateRepository.save(existing);
      return viewedAt;
    }

    await this.chatReadStateRepository.save(
      this.chatReadStateRepository.create({
        restaurantId,
        userId,
        chatsLastViewedAt: viewedAt,
      }),
    );

    return viewedAt;
  }

  private async countUnreadInboundMessages(
    restaurantId: number,
    lastViewedAt: Date | null,
  ): Promise<number> {
    const qb = this.messageRepository
      .createQueryBuilder('message')
      .innerJoin('message.conversation', 'conversation')
      .where('conversation.restaurantId = :restaurantId', { restaurantId })
      .andWhere('message.direction = :direction', {
        direction: StoredMessageDirection.INBOUND,
      })
      .andWhere('message.sentByCustomerId IS NOT NULL');

    if (lastViewedAt) {
      qb.andWhere('message.sentAt > :lastViewedAt', { lastViewedAt });
    }

    return qb.getCount();
  }

  async getActiveFlowCustomers(
    restaurantId: number,
    page?: number,
    limit?: number,
  ): Promise<PaginatedActiveFlowCustomersDto> {
    const pagination = normalizePagination(page, limit);
    const inProgressStatuses = this.inProgressExecutionStatuses();

    const [items, total] = await this.executionRepository.findAndCount({
      where: {
        automation: { restaurantId },
        status: In(inProgressStatuses),
      },
      relations: ['automation', 'customer', 'currentNode'],
      order: { updatedAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return {
      data: items.map((execution) => this.toActiveFlowCustomer(execution)),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async getConversation(
    restaurantId: number,
    executionId: number,
  ): Promise<ConversationDetailDto> {
    const execution = await this.executionRepository
      .createQueryBuilder('execution')
      .innerJoinAndSelect('execution.automation', 'automation')
      .leftJoinAndSelect('execution.customer', 'customer')
      .leftJoinAndSelect('execution.currentNode', 'currentNode')
      .where('execution.id = :executionId', { executionId })
      .andWhere('automation.restaurantId = :restaurantId', { restaurantId })
      .getOne();

    if (!execution) {
      throw new NotFoundException('Automation run not found for this restaurant.');
    }

    const [logs, activityEvents] = await Promise.all([
      this.logRepository.find({
        where: { executionId },
        relations: ['node'],
        order: { createdAt: 'ASC' },
      }),
      this.activityRepository
        .createQueryBuilder('event')
        .where('event.restaurantId = :restaurantId', { restaurantId })
        .andWhere('event.eventType = :eventType', {
          eventType: ActivityEventType.MESSAGE_SENT,
        })
        .andWhere("event.metadata->>'automationExecutionId' = :executionId", {
          executionId: String(executionId),
        })
        .orderBy('event.occurredAt', 'ASC')
        .getMany(),
    ]);

    const previewByNodeId = new Map<number, string>();
    for (const event of activityEvents) {
      const nodeId = Number(event.metadata?.nodeId);
      const preview = event.description?.trim();
      if (Number.isFinite(nodeId) && preview) {
        previewByNodeId.set(nodeId, preview);
      }
    }

    const messages = logs.map((log) =>
      this.toConversationMessage(log, previewByNodeId.get(log.nodeId)),
    );

    return {
      ...this.toActiveFlowCustomer(execution),
      messages,
    };
  }

  async getRestaurantChatCustomers(
    restaurantId: number,
    page?: number,
    limit?: number,
  ): Promise<PaginatedChatCustomersDto> {
    const pagination = normalizePagination(page, limit);

    const [conversations, total] = await this.conversationRepository.findAndCount(
      {
        where: {
          restaurantId,
          isPrivate: true,
          messageCount: MoreThan(0),
        },
        relations: ['customer', 'lastAutomation'],
        order: { lastMessageAt: 'DESC' },
        skip: pagination.skip,
        take: pagination.limit,
      },
    );

    const data = conversations.map((conversation) =>
      this.toChatCustomerSummary(conversation),
    );

    return {
      data,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async syncRestaurantChatCustomers(
    restaurantId: number,
    afterCustomerId: number,
    limit?: number,
  ): Promise<SyncChatCustomersDto> {
    const pagination = normalizePagination(1, limit);

    const cursor = await this.conversationRepository.findOne({
      where: {
        restaurantId,
        customerId: afterCustomerId,
        isPrivate: true,
      },
    });

    if (!cursor) {
      return { data: [] };
    }

    const conversations = await this.conversationRepository.find({
      where: {
        restaurantId,
        isPrivate: true,
        messageCount: MoreThan(0),
        createdAt: MoreThan(cursor.createdAt),
      },
      relations: ['customer', 'lastAutomation'],
      order: { createdAt: 'ASC' },
      take: pagination.limit,
    });

    return {
      data: conversations.map((conversation) =>
        this.toChatCustomerSummary(conversation),
      ),
    };
  }

  async getCustomerConversation(
    restaurantId: number,
    customerId: number,
  ): Promise<CustomerConversationDetailDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { restaurantId, customerId, isPrivate: true },
      relations: ['customer'],
    });

    if (!conversation || conversation.messageCount === 0) {
      throw new NotFoundException(
        'No messages found for this guest at this restaurant.',
      );
    }

    const messages = await this.messageRepository.find({
      where: { conversationId: conversation.id },
      relations: [
        'automation',
        'node',
        'sentByRestaurant',
        'sentByCustomer',
        'sentToRestaurant',
        'sentToCustomer',
      ],
      order: { sentAt: 'ASC' },
    });

    return {
      customerId,
      customerName: conversation.customer?.name ?? null,
      customerEmail: conversation.customer?.email ?? null,
      messages: messages.map((message) =>
        this.toConversationMessageFromStoredMessage(message),
      ),
    };
  }

  async syncCustomerConversationMessages(
    restaurantId: number,
    customerId: number,
    afterMessageId: number,
  ): Promise<CustomerConversationDetailDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { restaurantId, customerId, isPrivate: true },
      relations: ['customer'],
    });

    if (!conversation || conversation.messageCount === 0) {
      throw new NotFoundException(
        'No messages found for this guest at this restaurant.',
      );
    }

    const messages = await this.messageRepository.find({
      where: {
        conversationId: conversation.id,
        id: MoreThan(afterMessageId),
      },
      relations: [
        'automation',
        'node',
        'sentByRestaurant',
        'sentByCustomer',
        'sentToRestaurant',
        'sentToCustomer',
      ],
      order: { sentAt: 'ASC' },
    });

    return {
      customerId,
      customerName: conversation.customer?.name ?? null,
      customerEmail: conversation.customer?.email ?? null,
      messages: messages.map((message) =>
        this.toConversationMessageFromStoredMessage(message),
      ),
    };
  }

  private inProgressExecutionStatuses(): AutomationExecutionStatus[] {
    return [
      AutomationExecutionStatus.QUEUED,
      AutomationExecutionStatus.RUNNING,
      AutomationExecutionStatus.WAITING,
      AutomationExecutionStatus.PAUSED,
    ];
  }

  private toActiveFlowCustomer(
    execution: AutomationExecution,
  ): ActiveFlowCustomerDto {
    return {
      executionId: execution.id,
      customerId: execution.customerId,
      customerName: execution.customer?.name ?? null,
      customerEmail: execution.customer?.email ?? null,
      automationId: execution.automationId,
      automationName:
        execution.automation?.name ?? `Automation #${execution.automationId}`,
      status: execution.status,
      stepType: execution.currentNode?.type ?? null,
      scheduledAt: execution.scheduledAt ?? null,
      startedAt: execution.createdAt,
      updatedAt: execution.updatedAt,
    };
  }

  private toChatCustomerSummary(conversation: Conversation): ChatCustomerSummaryDto {
    return {
      customerId: conversation.customerId,
      customerName: conversation.customer?.name ?? null,
      customerEmail: conversation.customer?.email ?? null,
      messageCount: conversation.messageCount,
      lastMessagePreview: conversation.lastMessagePreview?.trim() ?? '',
      lastMessageChannel: this.channelToMessageKind(
        (conversation.lastMessageChannel as ConversationMessageChannel | null) ??
          ConversationMessageChannel.EMAIL,
      ),
      lastMessageAt: conversation.lastMessageAt ?? conversation.updatedAt,
      lastAutomationName:
        conversation.lastAutomation?.name ??
        (conversation.lastAutomationId
          ? `Automation #${conversation.lastAutomationId}`
          : null),
      createdAt: conversation.createdAt,
    };
  }

  private toConversationMessage(
    log: AutomationLog,
    preview?: string,
  ): ConversationMessageDto {
    const message = log.message.trim();
    const stepType = log.node?.type ?? null;
    const kind = this.resolveMessageKind(message, log.error);
    const direction: ConversationMessageDirection =
      kind === 'email' || kind === 'sms' || kind === 'whatsapp'
        ? 'outbound'
        : 'system';

    return {
      id: log.id,
      kind,
      direction,
      sentBy: null,
      sentTo: null,
      body: preview?.trim() || message,
      stepType,
      sentAt: log.createdAt,
      error: log.error ?? null,
    };
  }

  private resolveMessageKind(
    message: string,
    error: string | null,
  ): ConversationMessageKind {
    if (error?.trim()) {
      return 'error';
    }

    const normalized = message.toLowerCase();

    if (
      normalized.includes('email sent') ||
      normalized.includes('reward email') ||
      normalized.includes('payment reminder email') ||
      normalized.includes('qr pass email')
    ) {
      return 'email';
    }

    if (
      normalized.includes('sms sent') ||
      normalized.includes('text sent') ||
      normalized.includes('payment reminder text')
    ) {
      return 'sms';
    }

    if (normalized.includes('whatsapp')) {
      return 'whatsapp';
    }

    if (
      normalized.includes('failed') ||
      normalized.includes('could not restart')
    ) {
      return 'error';
    }

    return 'system';
  }

  private channelToMessageKind(
    channel: ConversationMessageChannel,
  ): ConversationMessageKind {
    switch (channel) {
      case ConversationMessageChannel.SMS:
        return 'sms';
      case ConversationMessageChannel.WHATSAPP:
        return 'whatsapp';
      case ConversationMessageChannel.EMAIL:
      default:
        return 'email';
    }
  }

  private toConversationMessageFromStoredMessage(
    message: ConversationMessage,
  ): ConversationMessageDto {
    const metadataError = message.metadata?.error;
    const error =
      typeof metadataError === 'string' && metadataError.trim()
        ? metadataError.trim()
        : null;

    return {
      id: message.id,
      kind: error ? 'error' : this.channelToMessageKind(message.channel),
      direction:
        message.direction === StoredMessageDirection.INBOUND
          ? 'inbound'
          : 'outbound',
      sentBy: this.toMessageParticipant(message, 'sentBy'),
      sentTo: this.toMessageParticipant(message, 'sentTo'),
      body: message.body.trim(),
      stepType: message.node?.type ?? null,
      sentAt: message.sentAt,
      error,
    };
  }

  private toMessageParticipant(
    message: ConversationMessage,
    side: 'sentBy' | 'sentTo',
  ): ConversationMessageParticipantDto | null {
    if (side === 'sentBy') {
      if (message.sentByRestaurantId != null) {
        return {
          type: 'restaurant',
          id: message.sentByRestaurantId,
          name: message.sentByRestaurant?.name ?? null,
          email: null,
        };
      }
      if (message.sentByCustomerId != null) {
        return {
          type: 'customer',
          id: message.sentByCustomerId,
          name: message.sentByCustomer?.name ?? null,
          email: message.sentByCustomer?.email ?? null,
        };
      }
      return null;
    }

    if (message.sentToCustomerId != null) {
      return {
        type: 'customer',
        id: message.sentToCustomerId,
        name: message.sentToCustomer?.name ?? null,
        email: message.sentToCustomer?.email ?? null,
      };
    }
    if (message.sentToRestaurantId != null) {
      return {
        type: 'restaurant',
        id: message.sentToRestaurantId,
        name: message.sentToRestaurant?.name ?? null,
        email: null,
      };
    }
    return null;
  }

  /** Maps a stored conversation row for API and realtime chat payloads. */
  mapStoredMessageToDto(message: ConversationMessage): ConversationMessageDto {
    return this.toConversationMessageFromStoredMessage(message);
  }

  resolveChannelMessageKind(
    channel: ConversationMessageChannel | string | null | undefined,
  ): ConversationMessageKind {
    if (!channel) {
      return 'email';
    }

    const normalized = String(channel).toLowerCase();
    if (normalized === ConversationMessageChannel.SMS) {
      return 'sms';
    }
    if (normalized === ConversationMessageChannel.WHATSAPP) {
      return 'whatsapp';
    }
    return 'email';
  }
}
