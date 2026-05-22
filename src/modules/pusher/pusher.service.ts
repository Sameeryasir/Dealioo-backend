import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Pusher from 'pusher';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { PUSHER_EVENT, pusherExecutionChannel } from './pusher.constants';
import type { ExecutionTerminalPusherPayload } from './pusher.types';

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
    await this.trigger(PUSHER_EVENT.EXECUTION_COMPLETED, payload);
  }

  async notifyExecutionFailed(
    payload: ExecutionTerminalPusherPayload,
  ): Promise<void> {
    await this.trigger(PUSHER_EVENT.EXECUTION_FAILED, payload);
  }

  private async trigger(
    event: string,
    payload: ExecutionTerminalPusherPayload,
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    const channel = pusherExecutionChannel(payload.executionId);

    try {
      await this.client.trigger(channel, event, payload);
      this.logger.log(
        `Pusher send → channel: ${channel} | event: ${event} | payload: ${JSON.stringify(payload)}`,
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
