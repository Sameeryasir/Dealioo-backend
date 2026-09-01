import { Injectable } from '@nestjs/common';
import type { AutomationExecution } from '../../db/entities/automation-execution.entity';
import { AutomationExecutionEventType } from '../../db/entities/automation-execution-event.entity';
import { AutomationExecutionEventService } from './automation-execution-event.service';
import { AutomationExecutionService } from './automation-execution.service';

@Injectable()
export class AutomationExecutionRecorderService {
  constructor(
    private readonly executionService: AutomationExecutionService,
    private readonly eventService: AutomationExecutionEventService,
  ) {}

  async recordEvent(
    execution: AutomationExecution,
    eventType: AutomationExecutionEventType,
    nodeId?: number | null,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const refreshed = await this.executionService.findById(execution.id);
    const context = this.eventService.mergeContext(refreshed.executionContext, {
      stepHistoryPointer: refreshed.lastEventId ?? undefined,
    });
    const snapshot = this.eventService.buildSnapshotFromExecution({
      ...refreshed,
      executionContext: context as Record<string, unknown>,
    });

    await this.eventService.appendEvent({
      executionId: execution.id,
      eventType,
      nodeId,
      snapshot,
      details,
    });
  }
}
