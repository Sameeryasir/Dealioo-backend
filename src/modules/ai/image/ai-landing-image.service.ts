import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FunnelPageType } from '../../../db/entities/funnel-page-type';
import { CAMPAIGNS_UPLOAD_SUBDIR } from '../../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../../utils/persist-uploaded-file';
import { FunnelPagesService } from '../../funnel-pages/funnel-pages.service';
import { SpacesService } from '../../spaces/spaces.service';
import { GeminiImageProvider } from './gemini-image.provider';

export type GenerateAndUploadLandingImageInput = {
  prompt: string;
  businessId?: number;
  campaignId?: number;
  funnelId?: number;
};

export type GenerateAndUploadLandingImageResult = {
  success: true;
  imageUrl: string;
  mimeType: string;
  promptUsed: string;
  message: string;
  schema?: Record<string, unknown>;
};

@Injectable()
export class AiLandingImageService {
  constructor(
    private readonly geminiImage: GeminiImageProvider,
    private readonly spacesService: SpacesService,
    private readonly funnelPagesService: FunnelPagesService,
  ) {}

  async generateAndUpload(
    input: GenerateAndUploadLandingImageInput,
  ): Promise<GenerateAndUploadLandingImageResult> {
    const prompt = input.prompt?.trim() ?? '';
    if (prompt.length < 3) {
      throw new BadRequestException(
        'Provide a short description of the landing hero image to generate.',
      );
    }

    const generated = await this.geminiImage.generateImageBytes(prompt);

    if (!this.spacesService.isConfigured()) {
      throw new ServiceUnavailableException(
        'File storage is not configured. Set DigitalOcean Spaces credentials in .env.',
      );
    }

    const multerFile = this.toMulterFile(generated);
    const imageUrl = await persistUploadedFile(
      this.spacesService,
      multerFile,
      CAMPAIGNS_UPLOAD_SUBDIR,
      'absolute',
    );

    if (!imageUrl?.trim()) {
      throw new BadRequestException('Upload failed after image generation.');
    }

    const trimmedUrl = imageUrl.trim();
    const schema = await this.persistLandingHeroImage({
      imageUrl: trimmedUrl,
      businessId: input.businessId,
      funnelId: input.funnelId,
    });

    return {
      success: true,
      imageUrl: trimmedUrl,
      mimeType: generated.mimeType,
      promptUsed: prompt,
      message: 'Done — I generated a new landing hero image.',
      ...(schema != null ? { schema } : {}),
    };
  }

  async clearLandingHeroImage(input: {
    businessId?: number;
    funnelId?: number;
  }): Promise<{
    success: true;
    imageUrl: string;
    message: string;
    schema?: Record<string, unknown>;
  }> {
    const schema = await this.persistLandingHeroImage({
      imageUrl: '',
      businessId: input.businessId,
      funnelId: input.funnelId,
    });

    return {
      success: true,
      imageUrl: '',
      message: 'Done — I removed the landing hero image.',
      ...(schema != null ? { schema } : {}),
    };
  }

  private async persistLandingHeroImage(input: {
    imageUrl: string;
    businessId?: number;
    funnelId?: number;
  }): Promise<Record<string, unknown> | undefined> {
    if (
      input.funnelId == null ||
      input.funnelId < 1 ||
      input.businessId == null ||
      input.businessId < 1
    ) {
      return undefined;
    }

    const assembled = await this.funnelPagesService.loadAssembledPages(
      input.funnelId,
    );
    const landing = this.asObject(assembled[FunnelPageType.LANDING]);
    landing.heroImageSrc = input.imageUrl;
    landing.imageUrl = input.imageUrl;

    await this.funnelPagesService.syncPages({
      funnelId: input.funnelId,
      businessId: input.businessId,
      pages: {
        [FunnelPageType.LANDING]: landing,
      },
      onlyTypes: [FunnelPageType.LANDING],
      operationId: `ai-landing-image-${randomUUID()}`,
    });

    return this.funnelPagesService.loadAssembledPages(input.funnelId);
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return structuredClone(value as Record<string, unknown>);
    }
    return {};
  }

  private toMulterFile(generated: {
    buffer: Buffer;
    mimeType: string;
    extension: string;
  }): Express.Multer.File {
    const originalname = `ai-landing-${randomUUID()}.${generated.extension}`;
    return {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype: generated.mimeType,
      size: generated.buffer.length,
      buffer: generated.buffer,
      destination: '',
      filename: originalname,
      path: '',
      stream: undefined as unknown as Express.Multer.File['stream'],
    };
  }
}
