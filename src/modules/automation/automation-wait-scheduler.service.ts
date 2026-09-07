import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hostname } from 'os';
import { Repository } from 'typeorm';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationExecutionObservabilityService } from './automation-execution-observability.service';
import { AutomationDeadLetterService } from './automation-dead-letter.service';
import { AutomationQueueService } from './automation-queue.service';
import {
  resolveWaitPollBatchSize,
  resolveWaitPollIntervalMs,
} from './automation-wait-scheduler.constants';

@Injectable()
export class AutomationWaitSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomationWaitSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private stuckSweepCounter = 0;
  private pollInFlight = false;
  private readonly ownerId = `${hostname()}:${process.pid}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  constructor(
    @InjectRepository(AutomationExecution)
    private readonly executionRepository: Repository<AutomationExecution>,
    private readonly executionService: AutomationExecutionService,
    private readonly queueService: AutomationQueueService,
    private readonly observabilityService: AutomationExecutionObservabilityService,
    private readonly deadLetterService: AutomationDeadLetterService,
  ) {}

  onModuleInit(): void {
    const intervalMs = resolveWaitPollIntervalMs();
    this.timer = setInterval(() => {
      void this.pollDueWaits().catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Wait poll failed';
        this.logger.error(`Wait scheduler poll failed: ${message}`);
      });
      this.stuckSweepCounter += 1;
      if (this.stuckSweepCounter % 10 === 0) {
        void this.runStuckSweepIfLeader().catch((error) => {
          const message =
            error instanceof Error ? error.message : 'Stuck sweep failed';
          this.logger.error(`Stuck execution sweep failed: ${message}`);
        });
      }
    }, intervalMs);
    this.logger.log(
      `DB wait scheduler polling every ${intervalMs}ms (leader=${this.ownerId})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runStuckSweepIfLeader(): Promise<void> {
    const isLeader = await this.queueService.tryClaimWaitPollLeadership(
      this.ownerId,
      Math.max(15, Math.ceil(resolveWaitPollIntervalMs() / 1000) * 2),
    );
    if (!isLeader) {
      return;
    }
    const result = await this.observabilityService.recoverStuckExecutions();
    if (result.requeued > 0 || result.timedOut > 0) {
      this.logger.warn(
        `Stuck sweep requeued=${result.requeued} timed_out=${result.timedOut}`,
      );
    }

    const deadLetters =
      await this.deadLetterService.listRetryableProviderOutages(20);
    for (const entry of deadLetters) {
      try {
        await this.deadLetterService.retryDeadLetter(entry.id);
        this.logger.warn(
          `Auto-retried provider dead-letter id=${entry.id} job=${entry.jobName}`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Dead-letter retry failed';
        this.logger.warn(
          `Auto-retry failed for dead-letter id=${entry.id}: ${message}`,
        );
      }
    }
  }

  async pollDueWaits(): Promise<number> {
    if (this.pollInFlight) {
      return 0;
    }
    this.pollInFlight = true;
    try {
      const isLeader = await this.queueService.tryClaimWaitPollLeadership(
        this.ownerId,
        Math.max(15, Math.ceil(resolveWaitPollIntervalMs() / 1000) * 2),
      );
      if (!isLeader) {
        return 0;
      }

      const now = new Date();
      const batchSize = resolveWaitPollBatchSize();
      return await this.executionRepository.manager.transaction(
        async (manager) => {
          const due = await manager
            .createQueryBuilder(AutomationExecution, 'execution')
            .innerJoinAndSelect('execution.automation', 'automation')
            .where('execution.status = :status', {
              status: AutomationExecutionStatus.WAITING,
            })
            .andWhere('execution.scheduledAt IS NOT NULL')
            .andWhere('execution.scheduledAt <= :now', { now })
            .orderBy('execution.scheduledAt', 'ASC')
            .take(batchSize)
            .setLock('pessimistic_partial_write')
            .getMany();

          let enqueued = 0;
          for (const execution of due) {
            if (
              !execution.automation?.isActive ||
              !execution.automation.published
            ) {
              await this.executionService.pauseExecution(execution.id);
              continue;
            }
            try {
              if (await this.queueService.hasPendingResumeJob(execution.id)) {
                continue;
              }
              await this.queueService.addResumeExecution(
                { executionId: execution.id },
                0,
              );
              enqueued += 1;
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : 'Resume enqueue failed';
              this.logger.warn(
                `Left execution ${execution.id} WAITING in Postgres (queue unavailable): ${message}`,
              );
            }
          }

          if (enqueued > 0) {
            this.logger.log(`Enqueued ${enqueued} due wait resume job(s)`);
          }

          return enqueued;
        },
      );
    } finally {
      this.pollInFlight = false;
    }
  }
}
