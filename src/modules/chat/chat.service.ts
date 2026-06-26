import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import {
  ActiveFlowCustomerDto,
  ConversationDetailDto,
  ConversationMessageDirection,
  ConversationMessageDto,
  ConversationMessageKind,
  PaginatedActiveFlowCustomersDto,
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
  ) {}

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
}
