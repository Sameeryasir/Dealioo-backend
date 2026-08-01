import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EditUiDto } from './dto/edit-ui.dto';
import {
  AiEditUiQueueService,
  type AiEditUiJobStatusResponse,
  type EnqueueAiEditUiResponse,
} from './queue/ai-edit-ui-queue.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiEditUiQueueService: AiEditUiQueueService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('edit-ui')
  async editUi(@Body() dto: EditUiDto): Promise<EnqueueAiEditUiResponse> {
    console.log('[AI edit-ui] incoming payload:', JSON.stringify(dto, null, 2));
    return this.aiEditUiQueueService.enqueue(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('edit-ui/jobs/:jobId')
  async getEditUiJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<AiEditUiJobStatusResponse> {
    return this.aiEditUiQueueService.getJobStatus(jobId);
  }
}
