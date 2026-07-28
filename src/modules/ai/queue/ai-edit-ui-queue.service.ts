import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { AiResponseDto } from '../dto/ai-response.dto';
import type { EditUiDto } from '../dto/edit-ui.dto';
import {
  AI_EDIT_UI_JOB_OPTIONS,
  AI_EDIT_UI_QUEUE,
  AiEditUiJobName,
  type AiEditUiJobPayload,
} from './ai-edit-ui-queue.constants';

export type EnqueueAiEditUiResponse = {
  jobId: string;
  status: 'queued';
};

export type AiEditUiJobStatusResponse = {
  jobId: string;
  status: 'queued' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  result?: AiResponseDto;
  error?: string;
};

@Injectable()
export class AiEditUiQueueService {
  constructor(
    @InjectQueue(AI_EDIT_UI_QUEUE)
    private readonly aiEditUiQueue: Queue<AiEditUiJobPayload, AiResponseDto>,
  ) {}

  async enqueue(dto: EditUiDto): Promise<EnqueueAiEditUiResponse> {
    const job = await this.aiEditUiQueue.add(
      AiEditUiJobName.EDIT_UI,
      dto,
      AI_EDIT_UI_JOB_OPTIONS,
    );

    return {
      jobId: String(job.id),
      status: 'queued',
    };
  }

  async getJobStatus(jobId: string): Promise<AiEditUiJobStatusResponse> {
    const job = await this.aiEditUiQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`AI edit job not found: ${jobId}`);
    }

    const state = await job.getState();

    if (state === 'completed') {
      return {
        jobId,
        status: 'completed',
        result: job.returnvalue,
      };
    }

    if (state === 'failed') {
      return {
        jobId,
        status: 'failed',
        error: job.failedReason || 'AI edit job failed.',
      };
    }

    if (state === 'active') {
      return { jobId, status: 'active' };
    }

    if (state === 'delayed') {
      return { jobId, status: 'delayed' };
    }

    if (state === 'waiting' || state === 'waiting-children' || state === 'prioritized') {
      return { jobId, status: 'queued' };
    }

    return { jobId, status: 'unknown' };
  }
}
