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
import { BusinessUserChatReadState } from '../../db/entities/business-user-chat-read-state.entity';
import {
  ActiveFlowCustomerDto,
  ChatCustomerSummaryDto,
  ChatUnreadSummaryDto,
  ConversationDetailDto,
  ConversationMessageDirection,
  ConversationMessageDto,
  ConversationMessageKind,
  ConversationMessageParticipantDto,
  CustomerConversationMessagesDto,
  GuestConversationDto,
  PaginatedActiveFlowCustomersDto,
  PaginatedChatCustomersDto,
  SyncChatCustomersDto,
  SyncChatMessagesDto,
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
    @InjectRepository(BusinessUserChatReadState)
    private readonly chatReadStateRepository: Repository<BusinessUserChatReadState>,
  ) {}

  async getChatUnreadSummary(
    businessId: number,
    userId: number,
  ): Promise<ChatUnreadSummaryDto> {
    const readState = await this.chatReadStateRepository.findOne({
      where: { businessId, userId },
    });

    const unreadCount = await this.countUnreadInboundMessages(
      businessId,
      readState?.chatsLastViewedAt ?? null,
    );

    return {
      hasUnread: unreadCount > 0,
      unreadCount,
      chatsLastViewedAt: readState?.chatsLastViewedAt ?? null,
    };
  }

  async markBusinessChatsRead(
    businessId: number,
    userId: number,
  ): Promise<Date> {
    const viewedAt = new Date();
    const existing = await this.chatReadStateRepository.findOne({
      where: { businessId, userId },
    });

    if (existing) {
      existing.chatsLastViewedAt = viewedAt;
      await this.chatReadStateRepository.save(existing);
      return viewedAt;
    }

    await this.chatReadStateRepository.save(
      this.chatReadStateRepository.create({
        businessId,
        userId,
        chatsLastViewedAt: viewedAt,
      }),
    );

    return viewedAt;
  }

  private async countUnreadInboundMessages(
    businessId: number,
    lastViewedAt: Date | null,
  ): Promise<number> {
    const qb = this.messageRepository
      .createQueryBuilder('message')
      .innerJoin('message.conversation', 'conversation')
      .where('conversation.businessId = :businessId', { businessId })
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
    businessId: number,
    page?: number,
    limit?: number,
  ): Promise<PaginatedActiveFlowCustomersDto> {
    const pagination = normalizePagination(page, limit);
    const inProgressStatuses = this.inProgressExecutionStatuses();

    const [items, total] = await this.executionRepository.findAndCount({
      where: {
        automation: { businessId },
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
    businessId: number,
    executionId: number,
  ): Promise<ConversationDetailDto> {
    const execution = await this.executionRepository
      .createQueryBuilder('execution')
      .innerJoinAndSelect('execution.automation', 'automation')
      .leftJoinAndSelect('execution.customer', 'customer')
      .leftJoinAndSelect('execution.currentNode', 'currentNode')
      .where('execution.id = :executionId', { executionId })
      .andWhere('automation.businessId = :businessId', { businessId })
      .getOne();

    if (!execution) {
      throw new NotFoundException('Automation run not found for this business.');
    }

    const [logs, activityEvents] = await Promise.all([
      this.logRepository.find({
        where: { executionId },
        relations: ['node'],
        order: { createdAt: 'ASC' },
      }),
      this.activityRepository
        .createQueryBuilder('event')
        .where('event.businessId = :businessId', { businessId })
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

  async getBusinessChatCustomers(
    businessId: number,
    page?: number,
    limit?: number,
  ): Promise<PaginatedChatCustomersDto> {
    const pagination = normalizePagination(page, limit);

    const [conversations, total] = await this.conversationRepository.findAndCount(
      {
        where: {
          businessId,
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

  async syncBusinessChatCustomers(
    businessId: number,
    afterConversationId: number,
  ): Promise<SyncChatCustomersDto> {
    const cursor = await this.conversationRepository.findOne({
      where: {
        id: afterConversationId,
        businessId,
        isPrivate: true,
      },
    });

    if (!cursor) {
      return { data: [] };
    }

    const conversations = await this.conversationRepository.find({
      where: {
        businessId,
        isPrivate: true,
        messageCount: MoreThan(0),
        createdAt: MoreThan(cursor.createdAt),
      },
      relations: ['customer', 'lastAutomation'],
      order: { createdAt: 'ASC' },
    });

    return {
      data: conversations.map((conversation) =>
        this.toChatCustomerSummary(conversation),
      ),
    };
  }

  async getGuestConversation(
    businessId: number,
    conversationId: number,
  ): Promise<GuestConversationDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, businessId, isPrivate: true },
      relations: ['customer', 'lastAutomation'],
    });

    if (!conversation || conversation.messageCount === 0) {
      throw new NotFoundException(
        'No conversation found for this business.',
      );
    }

    return this.toGuestConversation(conversation);
  }

  async getCustomerConversationMessages(
    businessId: number,
    customerId: number,
  ): Promise<CustomerConversationMessagesDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { businessId, customerId, isPrivate: true },
    });

    if (!conversation || conversation.messageCount === 0) {
      throw new NotFoundException(
        'No messages found for this guest at this business.',
      );
    }

    const messages = await this.messageRepository.find({
      where: { conversationId: conversation.id },
      relations: [
        'automation',
        'automation.campaign',
        'node',
        'sentByBusiness',
        'sentByCustomer',
        'sentToBusiness',
        'sentToCustomer',
      ],
      order: { sentAt: 'ASC' },
    });

    return {
      conversationId: conversation.id,
      customerId,
      messages: messages.map((message) =>
        this.toConversationMessageFromStoredMessage(message),
      ),
    };
  }

  async syncCustomerConversationMessages(
    businessId: number,
    customerId: number,
    afterMessageId: number,
  ): Promise<CustomerConversationMessagesDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { businessId, customerId, isPrivate: true },
    });

    if (!conversation || conversation.messageCount === 0) {
      throw new NotFoundException(
        'No messages found for this guest at this business.',
      );
    }

    const messages = await this.messageRepository.find({
      where: {
        conversationId: conversation.id,
        id: MoreThan(afterMessageId),
      },
      relations: [
        'automation',
        'automation.campaign',
        'node',
        'sentByBusiness',
        'sentByCustomer',
        'sentToBusiness',
        'sentToCustomer',
      ],
      order: { sentAt: 'ASC' },
    });

    return {
      conversationId: conversation.id,
      customerId,
      messages: messages.map((message) =>
        this.toConversationMessageFromStoredMessage(message),
      ),
    };
  }

  async getConversationMessagesByConversationId(
    businessId: number,
    conversationId: number,
  ): Promise<CustomerConversationMessagesDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, businessId, isPrivate: true },
    });

    if (!conversation || conversation.messageCount === 0) {
      throw new NotFoundException(
        'No messages found for this conversation.',
      );
    }

    return this.getCustomerConversationMessages(
      businessId,
      conversation.customerId,
    );
  }

  async syncConversationMessagesByConversationId(
    businessId: number,
    conversationId: number,
    afterMessageId: number,
  ): Promise<CustomerConversationMessagesDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, businessId, isPrivate: true },
    });

    if (!conversation || conversation.messageCount === 0) {
      throw new NotFoundException(
        'No messages found for this conversation.',
      );
    }

    return this.syncCustomerConversationMessages(
      businessId,
      conversation.customerId,
      afterMessageId,
    );
  }

  /**
   * Business-wide message catch-up (parallel to conversation/sync).
   * Returns messages with id > afterMessageId for this business, grouped by conversation.
   */
  async syncBusinessChatMessages(
    businessId: number,
    afterMessageId: number,
  ): Promise<SyncChatMessagesDto> {
    const cursorId = Math.max(0, afterMessageId);

    const messages = await this.messageRepository
      .createQueryBuilder('message')
      .innerJoinAndSelect('message.conversation', 'conversation')
      .leftJoinAndSelect('message.automation', 'automation')
      .leftJoinAndSelect('automation.campaign', 'campaign')
      .leftJoinAndSelect('message.node', 'node')
      .leftJoinAndSelect('message.sentByBusiness', 'sentByBusiness')
      .leftJoinAndSelect('message.sentByCustomer', 'sentByCustomer')
      .leftJoinAndSelect('message.sentToBusiness', 'sentToBusiness')
      .leftJoinAndSelect('message.sentToCustomer', 'sentToCustomer')
      .where('conversation.businessId = :businessId', { businessId })
      .andWhere('conversation.isPrivate = true')
      .andWhere('message.id > :cursorId', { cursorId })
      .orderBy('message.id', 'ASC')
      .take(1000)
      .getMany();

    const byConversation = new Map<
      number,
      {
        conversationId: number;
        customerId: number;
        messages: ConversationMessageDto[];
      }
    >();

    for (const message of messages) {
      const conversationId = message.conversationId;
      const customerId = message.conversation?.customerId;
      if (!customerId) {
        continue;
      }

      let thread = byConversation.get(conversationId);
      if (!thread) {
        thread = {
          conversationId,
          customerId,
          messages: [],
        };
        byConversation.set(conversationId, thread);
      }

      thread.messages.push(
        this.toConversationMessageFromStoredMessage(message),
      );
    }

    return {
      data: [...byConversation.values()],
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

  private toGuestConversation(conversation: Conversation): GuestConversationDto {
    const summary = this.toChatCustomerSummary(conversation);
    return {
      conversationId: conversation.id,
      customerId: summary.customerId,
      customerName: summary.customerName,
      customerEmail: summary.customerEmail,
      messageCount: summary.messageCount,
      lastMessagePreview: summary.lastMessagePreview,
      lastMessageChannel: summary.lastMessageChannel,
      lastMessageAt: summary.lastMessageAt,
      lastAutomationName: summary.lastAutomationName,
      createdAt: summary.createdAt,
    };
  }

  private toChatCustomerSummary(conversation: Conversation): ChatCustomerSummaryDto {
    return {
      conversationId: conversation.id,
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
      automationName: null,
      campaignName: null,
      funnelName: null,
      funnelId: null,
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
    const source = this.resolveAutomationSourceLabels(message);

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
      automationName: source.automationName,
      campaignName: source.campaignName,
      funnelName: source.funnelName,
      funnelId: source.funnelId,
    };
  }

  private resolveAutomationSourceLabels(message: ConversationMessage): {
    automationName: string | null;
    campaignName: string | null;
    funnelName: string | null;
    funnelId: number | null;
  } {
    const metadata = message.metadata ?? {};
    const metaAutomationName =
      typeof metadata.automationName === 'string'
        ? metadata.automationName.trim()
        : '';
    const metaCampaignName =
      typeof metadata.campaignName === 'string'
        ? metadata.campaignName.trim()
        : '';
    const metaFunnelName =
      typeof metadata.funnelName === 'string'
        ? metadata.funnelName.trim()
        : '';
    const metaFunnelIdRaw = metadata.funnelId;
    const metaFunnelId =
      typeof metaFunnelIdRaw === 'number'
        ? metaFunnelIdRaw
        : Number(metaFunnelIdRaw);

    const automationName =
      metaAutomationName ||
      message.automation?.name?.trim() ||
      (message.automationId != null
        ? `Automation #${message.automationId}`
        : null);

    const campaignName =
      metaCampaignName ||
      message.automation?.campaign?.campaignName?.trim() ||
      null;

    const funnelId =
      (Number.isFinite(metaFunnelId) && metaFunnelId > 0
        ? metaFunnelId
        : null) ??
      message.automation?.funnelId ??
      null;

    const funnelName =
      metaFunnelName ||
      campaignName ||
      (funnelId != null ? `Funnel #${funnelId}` : null);

    return {
      automationName: automationName || null,
      campaignName: campaignName || null,
      funnelName: funnelName || null,
      funnelId,
    };
  }

  private toMessageParticipant(
    message: ConversationMessage,
    side: 'sentBy' | 'sentTo',
  ): ConversationMessageParticipantDto | null {
    if (side === 'sentBy') {
      if (message.sentByBusinessId != null) {
        return {
          type: 'business',
          id: message.sentByBusinessId,
          name: message.sentByBusiness?.name ?? null,
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
    if (message.sentToBusinessId != null) {
      return {
        type: 'business',
        id: message.sentToBusinessId,
        name: message.sentToBusiness?.name ?? null,
        email: null,
      };
    }
    return null;
  }

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
