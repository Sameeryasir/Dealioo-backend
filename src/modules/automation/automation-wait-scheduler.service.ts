import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationQueueService } from './automation-queue.service';
import { resolveWaitPollIntervalMs } from './automation-wait-scheduler.constants';

@Injectable()
export class AutomationWaitSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutomationWaitSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(AutomationExecution)
    private readonly executionRepository: Repository<AutomationExecution>,
    private readonly executionService: AutomationExecutionService,
    private readonly queueService: AutomationQueueService,
  ) {}

  onModuleInit(): void {
    const intervalMs = resolveWaitPollIntervalMs();
    this.timer = setInterval(() => {
      void this.pollDueWaits().catch((error) => {
        const message =
          error instanceof Error ? error.message : 'Wait poll failed';
        this.logger.error(`Wait scheduler poll failed: ${message}`);
      });
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
    const due = await this.executionRepository.find({
      where: {
        status: AutomationExecutionStatus.WAITING,
        scheduledAt: LessThanOrEqual(now),
      },
      relations: ['automation'],
      take: 100,
      order: { scheduledAt: 'ASC' },
    });

    for (const execution of due) {
      if (!execution.automation?.isActive) {
        await this.executionService.pauseExecution(execution.id);
        continue;
      }
      if (await this.queueService.hasPendingResumeJob(execution.id)) {
        continue;
      }
      await this.queueService.addResumeExecution({ executionId: execution.id }, 0);
    }

    if (due.length > 0) {
      this.logger.log(`Enqueued ${due.length} due wait resume job(s)`);
    }

    return due.length;
  }
}
