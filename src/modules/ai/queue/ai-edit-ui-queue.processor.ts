import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { AiOrchestratorService } from '../ai.orchestrator.service';
import type { AiResponseDto } from '../dto/ai-response.dto';
import {
  AI_EDIT_UI_QUEUE,
  AiEditUiJobName,
  type AiEditUiJobPayload,
} from './ai-edit-ui-queue.constants';
import { AiEditUiRealtimeService } from './ai-edit-ui-realtime.service';

@Processor(AI_EDIT_UI_QUEUE, { concurrency: 2 })
export class AiEditUiQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AiEditUiQueueProcessor.name);

  constructor(
    private readonly aiOrchestrator: AiOrchestratorService,
    private readonly aiEditUiRealtime: AiEditUiRealtimeService,
  ) {
    super();
  }

  async process(
    job: Job<AiEditUiJobPayload, AiResponseDto>,
  ): Promise<AiResponseDto> {
    if (job.name !== AiEditUiJobName.EDIT_UI) {
      this.logger.warn(`Ignoring unknown AI edit job name=${job.name}`);
      throw new UnrecoverableError(`Unknown AI edit job name: ${job.name}`);
    }

    const jobId = String(job.id);
    const businessId = job.data.businessId;

    this.logger.log(
      `AI edit-ui job ${jobId}: business=${businessId} attempt=${job.attemptsMade + 1}`,
    );

    try {
      const result = await this.aiOrchestrator.editUi(job.data);
      await this.aiEditUiRealtime.notifyResult({
        businessId,
        jobId,
        status: 'completed',
        result,
      });
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'AI edit-ui job failed.';
      this.logger.error(`AI edit-ui job ${jobId} failed: ${message}`);
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      if (isFinalAttempt) {
        await this.aiEditUiRealtime.notifyResult({
          businessId,
          jobId,
          status: 'failed',
          error: message,
        });
      }
      throw error;
    }
  }
}
