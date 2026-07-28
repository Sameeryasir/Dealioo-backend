import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  AiProvider,
  AiProviderCompleteOptions,
} from '../interfaces/ai-provider.interface';
import { toAiUserFacingErrorMessage } from '../utils/ai-user-facing-error';

@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';

  private client: GoogleGenerativeAI | null = null;

  constructor(private readonly config: ConfigService) {}

  async complete(
    prompt: string,
    options?: AiProviderCompleteOptions,
  ): Promise<string> {
    const modelName = options?.model?.trim() || this.getConfiguredModel();
    console.log('[GeminiProvider] using model:', modelName);

    try {
      const model = this.getClient().getGenerativeModel({
        model: modelName,
        generationConfig: {
          ...(options?.maxTokens != null
            ? { maxOutputTokens: options.maxTokens }
            : {}),
          ...(options?.temperature != null
            ? { temperature: options.temperature }
            : {}),
        },
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text()?.trim() ?? '';

      console.log('[GeminiProvider] raw Gemini reply:', text);

      if (!text) {
        throw new InternalServerErrorException(
          'Gemini returned an empty response.',
        );
      }

      return text;
    } catch (error) {
      if (
        error instanceof InternalServerErrorException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      const raw =
        error instanceof Error ? error.message : 'Unknown Gemini API error';
      console.error('[GeminiProvider] request failed:', raw);

      throw new ServiceUnavailableException(toAiUserFacingErrorMessage(raw));
    }
  }

  private getConfiguredModel(): string {
    const model = this.config.get<string>('GEMINI_MODEL')?.trim();
    if (!model) {
      throw new ServiceUnavailableException(
        'GEMINI_MODEL is not configured. Set it in the environment to use the AI Funnel Editor.',
      );
    }
    return model;
  }

  private getClient(): GoogleGenerativeAI {
    if (this.client) {
      return this.client;
    }

    const apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'GEMINI_API_KEY is not configured. Set it in the environment to use the AI Funnel Editor.',
      );
    }

    this.client = new GoogleGenerativeAI(apiKey);
    return this.client;
  }
}
