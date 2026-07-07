import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AutomationExecutionStatus } from '../../db/entities/automation-execution.entity';
import { AutomationExecutionEventType } from '../../db/entities/automation-execution-event.entity';
import { normalizeExecutionContext } from './automation-execution-context.types';
import { AutomationExecutionEventService } from './automation-execution-event.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationQueueService } from './automation-queue.service';

@Injectable()
export class AutomationExecutionRecoveryService {
  constructor(
    private readonly executionService: AutomationExecutionService,
    private readonly eventService: AutomationExecutionEventService,
    private readonly queueService: AutomationQueueService,
  ) {}

  async recoverExecution(executionId: number): Promise<{
    executionId: number;
    currentNodeId: number;
    status: AutomationExecutionStatus;
  }> {
    const execution = await this.executionService.findById(executionId);
    const events = await this.eventService.findByExecutionId(executionId);
    const replayed = this.eventService.replaySnapshotFromEvents(events);

    if (!replayed) {
      throw new BadRequestException(
        'No execution events found — cannot rebuild state from history.',
      );
    }

    const scheduledAt = replayed.scheduledAt
      ? new Date(replayed.scheduledAt)
      : null;
    const status = replayed.status as AutomationExecutionStatus;
    const context = normalizeExecutionContext(
      replayed.executionContext as Record<string, unknown>,
    );

    await this.executionService.applyRecoveredState(executionId, {
      currentNodeId: replayed.currentNodeId,
      status,
      scheduledAt,
      automationVersion: replayed.automationVersion,
      executionContext: context as Record<string, unknown>,
    });

    const refreshed = await this.executionService.findById(executionId);
    const snapshot = this.eventService.buildSnapshotFromExecution(refreshed);

    await this.eventService.appendEvent({
      executionId,
      eventType: AutomationExecutionEventType.RECOVERY_APPLIED,
      nodeId: replayed.currentNodeId,
      snapshot,
      details: { replayedFromEventCount: events.length },
    });

    if (
      status === AutomationExecutionStatus.RUNNING ||
      status === AutomationExecutionStatus.WAITING
    ) {
      if (
        status === AutomationExecutionStatus.WAITING &&
        scheduledAt &&
        scheduledAt.getTime() > Date.now()
      ) {
        return {
          executionId,
          currentNodeId: replayed.currentNodeId,
          status,
        };
      }

      const node = await this.executionService.findNodeForAutomation(
        refreshed.automationId,
        replayed.currentNodeId,
      );

      await this.queueService.addProcessExecution({
        executionId,
        nodeId: replayed.currentNodeId,
        nodeType: node.type,
      });
    }

    return {
      executionId,
      currentNodeId: replayed.currentNodeId,
      status,
    };
  }

  async getExecutionEvents(executionId: number) {
    await this.executionService.findById(executionId);
    return this.eventService.findByExecutionId(executionId);
  }
}
