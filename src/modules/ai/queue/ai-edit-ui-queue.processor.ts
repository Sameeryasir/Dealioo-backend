import { Processor, WorkerHost } from '@nestjs/bullmq';
import { HttpException, Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { AiOrchestratorService } from '../ai.orchestrator.service';
import type { AiResponseDto } from '../dto/ai-response.dto';
import { toAiUserFacingErrorMessage } from '../utils/ai-user-facing-error';
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
    console.log(
      `[AI edit-ui] job ${jobId} input:`,
      JSON.stringify(job.data, null, 2),
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
      const rawMessage = this.extractErrorMessage(error);
      this.logger.error(`AI edit-ui job ${jobId} failed: ${rawMessage}`);
      const userMessage = toAiUserFacingErrorMessage(rawMessage);
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      if (isFinalAttempt) {
        await this.aiEditUiRealtime.notifyResult({
          businessId,
          jobId,
          status: 'failed',
          error: userMessage,
        });
      }
      throw error;
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      if (
        typeof response === 'object' &&
        response !== null &&
        'message' in response
      ) {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string') {
          return message;
        }
        if (Array.isArray(message)) {
          return message.filter((part) => typeof part === 'string').join(' ');
        }
      }
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'AI edit-ui job failed.';
  }
}
