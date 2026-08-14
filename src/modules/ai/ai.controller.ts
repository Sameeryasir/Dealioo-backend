import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EditUiDto } from './dto/edit-ui.dto';
import { ClearLandingImageDto } from './dto/clear-landing-image.dto';
import { GenerateLandingImageDto } from './dto/generate-landing-image.dto';
import {
  AiLandingImageService,
  type GenerateAndUploadLandingImageResult,
} from './image/ai-landing-image.service';
import {
  AiEditUiQueueService,
  type AiEditUiJobStatusResponse,
  type EnqueueAiEditUiResponse,
} from './queue/ai-edit-ui-queue.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiEditUiQueueService: AiEditUiQueueService,
    private readonly aiLandingImageService: AiLandingImageService,
  ) {}

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

  @UseGuards(AuthGuard('jwt'))
  @Post('landing-image/generate')
  async generateLandingImage(
    @Body() dto: GenerateLandingImageDto,
  ): Promise<GenerateAndUploadLandingImageResult> {
    return this.aiLandingImageService.generateAndUpload({
      prompt: dto.prompt,
      ...(dto.businessId != null ? { businessId: dto.businessId } : {}),
      ...(dto.campaignId != null ? { campaignId: dto.campaignId } : {}),
      ...(dto.funnelId != null ? { funnelId: dto.funnelId } : {}),
    });
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('landing-image/clear')
  async clearLandingImage(
    @Body() dto: ClearLandingImageDto,
  ): Promise<{
    success: true;
    imageUrl: string;
    message: string;
    schema?: Record<string, unknown>;
  }> {
    return this.aiLandingImageService.clearLandingHeroImage({
      ...(dto.businessId != null ? { businessId: dto.businessId } : {}),
      ...(dto.funnelId != null ? { funnelId: dto.funnelId } : {}),
    });
  }
}
