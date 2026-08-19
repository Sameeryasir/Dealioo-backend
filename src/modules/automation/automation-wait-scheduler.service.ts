import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationExecutionObservabilityService } from './automation-execution-observability.service';
import { AutomationQueueService } from './automation-queue.service';
import { resolveWaitPollIntervalMs } from './automation-wait-scheduler.constants';

@Injectable()
export class AutomationWaitSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomationWaitSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private stuckSweepCounter = 0;

  constructor(
    @InjectRepository(AutomationExecution)
    private readonly executionRepository: Repository<AutomationExecution>,
    private readonly executionService: AutomationExecutionService,
    private readonly queueService: AutomationQueueService,
    private readonly observabilityService: AutomationExecutionObservabilityService,
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
        void this.observabilityService
          .recoverStuckExecutions()
          .then((recovered) => {
            if (recovered > 0) {
              this.logger.warn(
                `Marked ${recovered} stuck automation execution(s) as timed_out`,
              );
            }
          })
          .catch((error) => {
            const message =
              error instanceof Error ? error.message : 'Stuck sweep failed';
            this.logger.error(`Stuck execution sweep failed: ${message}`);
          });
      }
    }, intervalMs);
    this.logger.log(
      `DB wait scheduler polling every ${intervalMs}ms for due executions`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollDueWaits(): Promise<number> {
    const now = new Date();
    return this.executionRepository.manager.transaction(async (manager) => {
      const due = await manager
        .createQueryBuilder(AutomationExecution, 'execution')
        .innerJoinAndSelect('execution.automation', 'automation')
        .where('execution.status = :status', {
          status: AutomationExecutionStatus.WAITING,
        })
        .andWhere('execution.scheduledAt IS NOT NULL')
        .andWhere('execution.scheduledAt <= :now', { now })
        .orderBy('execution.scheduledAt', 'ASC')
        .take(100)
        .setLock('pessimistic_partial_write')
        .getMany();

      let enqueued = 0;
      for (const execution of due) {
        if (!execution.automation?.isActive || !execution.automation.published) {
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
            error instanceof Error ? error.message : 'Resume enqueue failed';
          this.logger.warn(
            `Left execution ${execution.id} WAITING in Postgres (queue unavailable): ${message}`,
          );
        }
      }

      if (enqueued > 0) {
        this.logger.log(`Enqueued ${enqueued} due wait resume job(s)`);
      }

      return enqueued;
    });
  }
}
