import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AutomationWorkerService {
  private readonly logger = new Logger(AutomationWorkerService.name);
  private readonly timers = new Map<number, NodeJS.Timeout>();

  enqueue(task: () => Promise<void>): void {
    setImmediate(() => {
      task().catch((error) => {
        this.logger.error('Automation worker task failed', error);
      });
    });
  }

  scheduleResume(
    executionId: number,
    delayMs: number,
    task: () => Promise<void>,
  ): void {
    const existing = this.timers.get(executionId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.timers.delete(executionId);
      task().catch((error) => {
        this.logger.error(
          `Failed to resume execution ${executionId}`,
          error,
        );
      });
    }, delayMs);

    this.timers.set(executionId, timer);
  }
}
