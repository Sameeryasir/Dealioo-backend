import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Modality } from '@google/genai';
import { toAiUserFacingErrorMessage } from '../utils/ai-user-facing-error';

export type GeneratedLandingImageBytes = {
  buffer: Buffer;
  mimeType: string;
  extension: string;
};

@Injectable()
export class GeminiImageProvider {
  readonly name = 'gemini-image';

  private client: GoogleGenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  async generateImageBytes(prompt: string): Promise<GeneratedLandingImageBytes> {
    const trimmed = prompt?.trim() ?? '';
    if (!trimmed) {
      throw new InternalServerErrorException('Image prompt is required.');
    }

    const modelName = this.getConfiguredImageModel();

    try {
      const response = await this.getClient().models.generateContent({
        model: modelName,
        contents: this.buildImagePrompt(trimmed),
        config: {
          responseModalities: [Modality.TEXT, Modality.IMAGE],
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const inline = part.inlineData;
        if (!inline?.data) continue;

        const mimeType = (inline.mimeType || 'image/png').trim() || 'image/png';
        const buffer = Buffer.from(inline.data, 'base64');
        if (!buffer.length) continue;

        return {
          buffer,
          mimeType,
          extension: this.extensionForMime(mimeType),
        };
      }

      throw new InternalServerErrorException(
        'Gemini returned no image data for that prompt.',
      );
    } catch (error) {
      if (
        error instanceof InternalServerErrorException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      const raw =
        error instanceof Error ? error.message : 'Unknown Gemini image error';
      throw new ServiceUnavailableException(toAiUserFacingErrorMessage(raw));
    }
  }

  private buildImagePrompt(userPrompt: string): string {
    return [
      'Create a single high-quality marketing hero image for a business landing page.',
      'Style: realistic photo or clean commercial photography, bright, conversion-friendly.',
      'Do not include watermarks, logos, UI chrome, or unreadable text overlays.',
      'Subject request:',
      userPrompt,
    ].join('\n');
  }

  private extensionForMime(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('gif')) return 'gif';
    return 'png';
  }

  private getConfiguredImageModel(): string {
    const model =
      this.config.get<string>('GEMINI_IMAGE_MODEL')?.trim() ||
      'gemini-2.5-flash-image';
    return model;
  }

  private getClient(): GoogleGenAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is not configured. Set it in the environment to generate landing images.',
      );
    }

    this.client = new GoogleGenAI({ apiKey });
    return this.client;
  }
}
