import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Pusher from 'pusher';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import {
  PUSHER_EVENT,
  pusherAutomationChannel,
  pusherBusinessActivityChannel,
  pusherBusinessConversationsChannel,
  pusherConversationMessagesChannel,
  pusherExecutionChannel,
} from './pusher.constants';
import type {
  CampaignActivityPusherPayload,
  ChatMessagePusherPayload,
  ExecutionTerminalPusherPayload,
} from './pusher.types';

@Injectable()
export class PusherService implements OnModuleInit {
  private readonly logger = new Logger(PusherService.name);
  private client: Pusher | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const appId = this.config.get<string>('PUSHER_APP_ID')?.trim();
    const key = this.config.get<string>('PUSHER_KEY')?.trim();
    const secret = this.config.get<string>('PUSHER_SECRET')?.trim();
    const cluster = this.config.get<string>('PUSHER_CLUSTER')?.trim();

    if (!appId || !key || !secret || !cluster) {
      this.logger.warn(
        'Pusher disabled: set PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER in .env',
      );
      return;
    }

    this.client = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    });

    this.logger.log(`Pusher ready (cluster: ${cluster})`);
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  authorizeChannel(
    socketId: string,
    channelName: string,
  ): { auth: string; channel_data?: string } {
    if (!this.client) {
      throw new ServiceUnavailableException('Realtime messaging is not configured.');
    }

    return this.client.authorizeChannel(socketId, channelName);
  }

  buildExecutionTerminalPayload(
    execution: AutomationExecution,
  ): ExecutionTerminalPusherPayload {
    const total = execution.totalRecipients ?? 0;
    const sent = execution.emailsSentCount ?? 0;
    let progressPercent = 0;
    if (total > 0) {
      progressPercent = Math.min(100, Math.round((sent / total) * 100));
    } else if (execution.status === AutomationExecutionStatus.COMPLETED) {
      progressPercent = 100;
    }

    return {
      executionId: execution.id,
      automationId: execution.automationId,
      status: execution.status,
      isTerminal: true,
      totalRecipients: total,
      emailsSent: sent,
      progressPercent,
      queueJobId: execution.queueJobId ?? null,
      lastError: execution.lastError ?? null,
      finishedAt: execution.updatedAt.toISOString(),
      stepType: execution.currentNode?.type ?? null,
    };
  }

  async notifyExecutionCompleted(
    payload: ExecutionTerminalPusherPayload,
  ): Promise<void> {
    await this.triggerExecution(PUSHER_EVENT.EXECUTION_COMPLETED, payload);
  }

  async notifyExecutionFailed(
    payload: ExecutionTerminalPusherPayload,
  ): Promise<void> {
    await this.triggerExecution(PUSHER_EVENT.EXECUTION_FAILED, payload);
  }

  async notifyChatMessageSent(
    payload: ChatMessagePusherPayload,
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    if (
      !Number.isFinite(payload.businessId) ||
      payload.businessId < 1 ||
      !Number.isFinite(payload.conversationId) ||
      payload.conversationId < 1
    ) {
      this.logger.warn(
        `Pusher chat notify skipped — invalid business/conversation id (business=${payload.businessId}, conversation=${payload.conversationId})`,
      );
      return;
    }

    const conversationsChannel = pusherBusinessConversationsChannel(
      payload.businessId,
    );
    const messagesChannel = pusherConversationMessagesChannel(
      payload.businessId,
      payload.conversationId,
    );

    try {
      const results = await Promise.allSettled([
        this.client.trigger(
          conversationsChannel,
          PUSHER_EVENT.CHAT_CONVERSATION_UPDATED,
          payload,
        ),
        this.client.trigger(
          messagesChannel,
          PUSHER_EVENT.CHAT_MESSAGE_SENT,
          payload,
        ),
      ]);

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const target =
            index === 0 ? conversationsChannel : messagesChannel;
          const reason =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          this.logger.error(
            `Pusher chat notify failed for ${target}: ${reason}`,
          );
        }
      });

      if (results.every((result) => result.status === 'fulfilled')) {
        this.logger.log(
          `Pusher send → channels: ${conversationsChannel}, ${messagesChannel} | events: ${PUSHER_EVENT.CHAT_CONVERSATION_UPDATED}, ${PUSHER_EVENT.CHAT_MESSAGE_SENT} | conversation: ${payload.conversationId} | message: ${payload.message.id}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Pusher trigger failed';
      this.logger.error(
        `Pusher chat notify failed for business ${payload.businessId}, conversation ${payload.conversationId}: ${message}`,
      );
    }
  }

  async notifyCampaignActivity(
    payload: CampaignActivityPusherPayload,
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    if (!Number.isFinite(payload.businessId) || payload.businessId < 1) {
      this.logger.warn(
        `Pusher activity notify skipped — invalid business id (${payload.businessId})`,
      );
      return;
    }

    const channel = pusherBusinessActivityChannel(payload.businessId);

    try {
      await this.client.trigger(
        channel,
        PUSHER_EVENT.ACTIVITY_CAMPAIGN_UPDATED,
        payload,
      );
      this.logger.log(
        `Pusher send → channel: ${channel} | event: ${PUSHER_EVENT.ACTIVITY_CAMPAIGN_UPDATED} | campaign: ${payload.campaignId} | type: ${payload.eventType}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Pusher trigger failed';
      this.logger.error(
        `Pusher activity notify failed for business ${payload.businessId}: ${message}`,
      );
    }
  }

  private async triggerExecution(
    event: string,
    payload: ExecutionTerminalPusherPayload,
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    const executionChannel = pusherExecutionChannel(payload.executionId);
    const automationChannel = pusherAutomationChannel(payload.automationId);

    try {
      await Promise.all([
        this.client.trigger(executionChannel, event, payload),
        this.client.trigger(automationChannel, event, payload),
      ]);
      this.logger.log(
        `Pusher send → channels: ${executionChannel}, ${automationChannel} | event: ${event} | payload: ${JSON.stringify(payload)}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Pusher trigger failed';
      this.logger.error(
        `Pusher notify failed for execution ${payload.executionId}: ${message}`,
      );
    }
  }
}
