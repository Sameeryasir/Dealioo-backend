import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AutomationExecutionEvent,
  AutomationExecutionEventType,
} from '../../db/entities/automation-execution-event.entity';
import { AutomationExecution } from '../../db/entities/automation-execution.entity';
import {
  buildExecutionSnapshot,
  type AutomationExecutionContext,
  type AutomationExecutionSnapshot,
} from './automation-execution-context.types';

@Injectable()
export class AutomationExecutionEventService {
  constructor(
    @InjectRepository(AutomationExecutionEvent)
    private readonly eventRepository: Repository<AutomationExecutionEvent>,
    @InjectRepository(AutomationExecution)
    private readonly executionRepository: Repository<AutomationExecution>,
  ) {}

  async appendEvent(params: {
    executionId: number;
    eventType: AutomationExecutionEventType;
    nodeId?: number | null;
    snapshot: AutomationExecutionSnapshot;
    details?: Record<string, unknown>;
  }): Promise<AutomationExecutionEvent> {
    const event = this.eventRepository.create({
      executionId: params.executionId,
      eventType: params.eventType,
      nodeId: params.nodeId ?? null,
      payload: {
        snapshot: params.snapshot,
        ...(params.details ?? {}),
      },
    });

    const saved = await this.eventRepository.save(event);

    await this.executionRepository.update(params.executionId, {
      lastEventId: saved.id,
      executionContext: params.snapshot.executionContext as object,
    });

    return saved;
  }

  async findByExecutionId(executionId: number): Promise<AutomationExecutionEvent[]> {
    return this.eventRepository.find({
      where: { executionId },
      order: { id: 'ASC' },
    });
  }

  replaySnapshotFromEvents(
    events: AutomationExecutionEvent[],
  ): AutomationExecutionSnapshot | null {
    if (events.length === 0) {
      return null;
    }

    for (let index = events.length - 1; index >= 0; index -= 1) {
      const payload = events[index].payload ?? {};
      const snapshot = payload.snapshot;
      if (snapshot && typeof snapshot === 'object') {
        return snapshot as AutomationExecutionSnapshot;
      }
    }

    return null;
  }

  buildSnapshotFromExecution(execution: AutomationExecution): AutomationExecutionSnapshot {
    return buildExecutionSnapshot(execution);
  }

  mergeContext(
    current: Record<string, unknown> | null | undefined,
    patch: Partial<AutomationExecutionContext>,
  ): AutomationExecutionContext {
    const base = (current ?? {}) as AutomationExecutionContext;
    return {
      ...base,
      ...patch,
      branchMemory: {
        ...(base.branchMemory ?? {}),
        ...(patch.branchMemory ?? {}),
      },
    };
  }
}
