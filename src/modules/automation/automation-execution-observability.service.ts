import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationExecutionEventType } from '../../db/entities/automation-execution-event.entity';
import {
  AutomationExecutionRecipient,
  AutomationRecipientDeliveryStatus,
} from '../../db/entities/automation-execution-recipient.entity';
import {
  AutomationExecutionStep,
  AutomationExecutionStepStatus,
} from '../../db/entities/automation-execution-step.entity';
import { AutomationExecutionEventService } from './automation-execution-event.service';
import { AutomationExecutionService } from './automation-execution.service';

type EnsureStepInput = {
  executionId: number;
  stepKey: string;
  stepLabel: string;
  nodeId?: number | null;
  phase?: string | null;
  metadata?: Record<string, unknown>;
};

type RecipientOutcomeInput = {
  executionId: number;
  customerId: number;
  status: AutomationRecipientDeliveryStatus;
  stepId?: number | null;
  nodeId?: number | null;
  phase?: string | null;
  reason?: string | null;
  attempt?: number;
  providerResponse?: Record<string, unknown> | null;
  error?: string | null;
};

@Injectable()
export class AutomationExecutionObservabilityService {
  private readonly logger = new Logger(
    AutomationExecutionObservabilityService.name,
  );

  constructor(
    @InjectRepository(AutomationExecution)
    private readonly executionRepository: Repository<AutomationExecution>,
    @InjectRepository(AutomationExecutionStep)
    private readonly stepRepository: Repository<AutomationExecutionStep>,
    @InjectRepository(AutomationExecutionRecipient)
    private readonly recipientRepository: Repository<AutomationExecutionRecipient>,
    private readonly executionService: AutomationExecutionService,
    private readonly eventService: AutomationExecutionEventService,
  ) {}

  async safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (error) {
      this.logger.warn(
        `Observability "${label}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async onBatchExecutionCreated(params: {
    executionId: number;
    nodeId: number;
    unpaidCount: number;
    triggeredByCron: boolean;
  }): Promise<void> {
    await this.safe('onBatchExecutionCreated', async () => {
      await this.executionRepository.update(params.executionId, {
        recipientsFound: params.unpaidCount,
        recipientsEligible: params.unpaidCount,
        startedAt: new Date(),
      });

      const execution = await this.executionService.findById(params.executionId);
      const snapshot = this.eventService.buildSnapshotFromExecution(execution);
      await this.eventService.appendEvent({
        executionId: params.executionId,
        eventType: AutomationExecutionEventType.EXECUTION_CREATED,
        nodeId: params.nodeId,
        snapshot,
        details: {
          unpaidCount: params.unpaidCount,
          triggeredByCron: params.triggeredByCron,
        },
      });
      await this.eventService.appendEvent({
        executionId: params.executionId,
        eventType: AutomationExecutionEventType.EXECUTION_STARTED,
        nodeId: params.nodeId,
        snapshot,
      });

      await this.ensureStep({
        executionId: params.executionId,
        stepKey: 'payment_email',
        stepLabel: 'Payment Email',
        nodeId: params.nodeId,
        phase: 'payment',
        metadata: { recipientsFound: params.unpaidCount },
      });
    });
  }

  async ensureStep(input: EnsureStepInput): Promise<AutomationExecutionStep | null> {
    return this.safe('ensureStep', async () => {
      const existing = await this.stepRepository.findOne({
        where: {
          executionId: input.executionId,
          stepKey: input.stepKey,
        },
      });
      if (existing) {
        return existing;
      }

      const step = this.stepRepository.create({
        executionId: input.executionId,
        stepKey: input.stepKey,
        stepLabel: input.stepLabel,
        nodeId: input.nodeId ?? null,
        phase: input.phase ?? null,
        status: AutomationExecutionStepStatus.PENDING,
        metadata: input.metadata ?? {},
      });
      return this.stepRepository.save(step);
    });
  }

  async startStep(params: {
    executionId: number;
    stepKey: string;
    stepLabel: string;
    nodeId?: number | null;
    phase?: string | null;
    recipientsTotal?: number;
  }): Promise<AutomationExecutionStep | null> {
    return this.safe('startStep', async () => {
      let step = await this.ensureStep({
        executionId: params.executionId,
        stepKey: params.stepKey,
        stepLabel: params.stepLabel,
        nodeId: params.nodeId,
        phase: params.phase,
      });
      if (!step) return null;

      if (
        step.status === AutomationExecutionStepStatus.COMPLETED ||
        step.status === AutomationExecutionStepStatus.FAILED
      ) {
        return step;
      }

      step.status = AutomationExecutionStepStatus.RUNNING;
      step.startedAt = step.startedAt ?? new Date();
      if (params.recipientsTotal != null) {
        step.recipientsTotal = Math.max(
          step.recipientsTotal,
          params.recipientsTotal,
        );
      }
      step = await this.stepRepository.save(step);

      const execution = await this.executionService.findById(params.executionId);
      await this.eventService.appendEvent({
        executionId: params.executionId,
        eventType: AutomationExecutionEventType.NODE_STARTED,
        nodeId: params.nodeId ?? null,
        snapshot: this.eventService.buildSnapshotFromExecution(execution),
        details: { stepKey: params.stepKey, phase: params.phase ?? null },
      });

      return step;
    });
  }

  async completeStep(params: {
    executionId: number;
    stepKey: string;
    status?: AutomationExecutionStepStatus;
    recipientsSent?: number;
    recipientsFailed?: number;
    recipientsSkipped?: number;
    error?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.safe('completeStep', async () => {
      const step = await this.stepRepository.findOne({
        where: {
          executionId: params.executionId,
          stepKey: params.stepKey,
        },
      });
      if (!step) return;

      const now = new Date();
      step.status =
        params.status ?? AutomationExecutionStepStatus.COMPLETED;
      step.completedAt = now;
      if (step.startedAt) {
        step.durationMs = Math.max(0, now.getTime() - step.startedAt.getTime());
      }
      if (params.recipientsSent != null) {
        step.recipientsSent += params.recipientsSent;
      }
      if (params.recipientsFailed != null) {
        step.recipientsFailed += params.recipientsFailed;
      }
      if (params.recipientsSkipped != null) {
        step.recipientsSkipped += params.recipientsSkipped;
      }
      if (params.error) {
        step.error = params.error;
      }
      if (params.metadata) {
        step.metadata = { ...step.metadata, ...params.metadata };
      }
      await this.stepRepository.save(step);

      const execution = await this.executionService.findById(params.executionId);
      await this.eventService.appendEvent({
        executionId: params.executionId,
        eventType:
          step.status === AutomationExecutionStepStatus.FAILED
            ? AutomationExecutionEventType.NODE_FAILED
            : AutomationExecutionEventType.NODE_COMPLETED,
        nodeId: step.nodeId,
        snapshot: this.eventService.buildSnapshotFromExecution(execution),
        details: {
          stepKey: params.stepKey,
          status: step.status,
          durationMs: step.durationMs,
        },
      });
    });
  }

  async recordRecipients(rows: RecipientOutcomeInput[]): Promise<void> {
    if (rows.length === 0) return;
    await this.safe('recordRecipients', async () => {
      const entities = rows.map((row) =>
        this.recipientRepository.create({
          executionId: row.executionId,
          stepId: row.stepId ?? null,
          customerId: row.customerId,
          nodeId: row.nodeId ?? null,
          phase: row.phase ?? null,
          status: row.status,
          reason: row.reason ?? null,
          attempt: row.attempt ?? 1,
          providerResponse: row.providerResponse ?? null,
          error: row.error ?? null,
          occurredAt: new Date(),
        }),
      );
      await this.recipientRepository.save(entities);
    });
  }

  async incrementMetrics(
    executionId: number,
    patch: Partial<{
      recipientsFiltered: number;
      recipientsSent: number;
      recipientsFailed: number;
      recipientsSkipped: number;
      recipientsBounced: number;
      recipientsPaidDuringWait: number;
      passEmailsSent: number;
    }>,
  ): Promise<void> {
    await this.safe('incrementMetrics', async () => {
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || !Number.isFinite(value) || value <= 0) continue;
        await this.executionRepository.increment(
          { id: executionId },
          key as keyof AutomationExecution,
          value,
        );
      }
    });
  }

  async onWaiting(params: {
    executionId: number;
    nodeId: number | null;
    waitDelayMs: number;
  }): Promise<void> {
    await this.safe('onWaiting', async () => {
      await this.startStep({
        executionId: params.executionId,
        stepKey: 'wait',
        stepLabel: 'Wait',
        nodeId: params.nodeId,
        phase: 'wait',
      });
      await this.completeStep({
        executionId: params.executionId,
        stepKey: 'wait',
        status: AutomationExecutionStepStatus.WAITING,
        metadata: { waitDelayMs: params.waitDelayMs },
      });

      const waitStep = await this.stepRepository.findOne({
        where: { executionId: params.executionId, stepKey: 'wait' },
      });
      if (waitStep) {
        waitStep.status = AutomationExecutionStepStatus.WAITING;
        await this.stepRepository.save(waitStep);
      }

      await this.ensureStep({
        executionId: params.executionId,
        stepKey: 'pass_email',
        stepLabel: 'Pass Email',
        nodeId: params.nodeId,
        phase: 'pass',
      });

      const execution = await this.executionService.findById(params.executionId);
      await this.eventService.appendEvent({
        executionId: params.executionId,
        eventType: AutomationExecutionEventType.EXECUTION_WAITING,
        nodeId: params.nodeId,
        snapshot: this.eventService.buildSnapshotFromExecution(execution),
        details: { waitDelayMs: params.waitDelayMs },
      });
      await this.eventService.appendEvent({
        executionId: params.executionId,
        eventType: AutomationExecutionEventType.WAIT_SCHEDULED,
        nodeId: params.nodeId,
        snapshot: this.eventService.buildSnapshotFromExecution(execution),
        details: { waitDelayMs: params.waitDelayMs },
      });
    });
  }

  async onExecutionFinished(params: {
    executionId: number;
    failed?: boolean;
    error?: string | null;
  }): Promise<void> {
    await this.safe('onExecutionFinished', async () => {
      const execution = await this.executionService.findById(params.executionId);
      const durationMs =
        execution.startedAt != null
          ? Math.max(0, Date.now() - execution.startedAt.getTime())
          : execution.createdAt
            ? Math.max(0, Date.now() - execution.createdAt.getTime())
            : null;

      const summary = {
        startedAt: (execution.startedAt ?? execution.createdAt)?.toISOString(),
        completedAt: (execution.completedAt ?? new Date()).toISOString(),
        durationMs,
        recipientsFound: execution.recipientsFound,
        recipientsEligible: execution.recipientsEligible,
        recipientsFiltered: execution.recipientsFiltered,
        recipientsSent: execution.recipientsSent,
        recipientsFailed: execution.recipientsFailed,
        recipientsSkipped: execution.recipientsSkipped,
        recipientsBounced: execution.recipientsBounced,
        recipientsPaidDuringWait: execution.recipientsPaidDuringWait,
        passEmailsSent: execution.passEmailsSent,
        emailsSentCount: execution.emailsSentCount,
        finalStatus: execution.status,
        error: params.error ?? execution.lastError,
      };

      const refreshed = await this.executionService.findById(params.executionId);
      refreshed.summary = summary;
      await this.executionRepository.save(refreshed);

      await this.eventService.appendEvent({
        executionId: params.executionId,
        eventType: params.failed
          ? AutomationExecutionEventType.EXECUTION_FAILED
          : AutomationExecutionEventType.EXECUTION_COMPLETED,
        nodeId: refreshed.currentNodeId,
        snapshot: this.eventService.buildSnapshotFromExecution(refreshed),
        details: summary,
      });
    });
  }

  async recoverStuckExecutions(params?: {
    runningOlderThanMs?: number;
    waitingPastScheduledByMs?: number;
    limit?: number;
  }): Promise<number> {
    const runningOlderThanMs = params?.runningOlderThanMs ?? 6 * 60 * 60_000;
    const waitingPastScheduledByMs =
      params?.waitingPastScheduledByMs ?? 2 * 60 * 60_000;
    const limit = params?.limit ?? 50;
    const now = Date.now();

    const stuckRunning = await this.executionRepository.find({
      where: {
        status: AutomationExecutionStatus.RUNNING,
        updatedAt: LessThan(new Date(now - runningOlderThanMs)),
      },
      take: limit,
      order: { updatedAt: 'ASC' },
    });

    const stuckWaiting = await this.executionRepository.find({
      where: {
        status: AutomationExecutionStatus.WAITING,
        scheduledAt: LessThan(new Date(now - waitingPastScheduledByMs)),
      },
      take: limit,
      order: { scheduledAt: 'ASC' },
    });

    let recovered = 0;
    for (const execution of [...stuckRunning, ...stuckWaiting]) {
      await this.executionService.markTimedOut(
        execution.id,
        `Auto-recovered stuck ${execution.status} execution (no progress)`,
      );
      await this.eventService.appendEvent({
        executionId: execution.id,
        eventType: AutomationExecutionEventType.EXECUTION_TIMED_OUT,
        nodeId: execution.currentNodeId,
        snapshot: this.eventService.buildSnapshotFromExecution(execution),
        details: { previousStatus: execution.status },
      });
      recovered += 1;
    }

    return recovered;
  }

  async findRecipientOutcomes(params: {
    executionId: number;
    customerId?: number;
  }): Promise<AutomationExecutionRecipient[]> {
    return this.recipientRepository.find({
      where: {
        executionId: params.executionId,
        ...(params.customerId != null
          ? { customerId: params.customerId }
          : {}),
      },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
  }

  async findSteps(executionId: number): Promise<AutomationExecutionStep[]> {
    return this.stepRepository.find({
      where: { executionId },
      order: { id: 'ASC' },
    });
  }

  async findOpenExecutionsForAutomation(
    automationId: number,
  ): Promise<AutomationExecution[]> {
    return this.executionRepository.find({
      where: {
        automationId,
        status: In([
          AutomationExecutionStatus.QUEUED,
          AutomationExecutionStatus.RUNNING,
          AutomationExecutionStatus.WAITING,
        ]),
      },
      order: { id: 'ASC' },
    });
  }
}
