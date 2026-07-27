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

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';

@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';

  private client: GoogleGenerativeAI | null = null;
  private readonly defaultModel: string;

  constructor(private readonly config: ConfigService) {
    this.defaultModel =
      this.config.get<string>('GEMINI_MODEL')?.trim() || DEFAULT_GEMINI_MODEL;
  }

  async complete(
    prompt: string,
    options?: AiProviderCompleteOptions,
  ): Promise<string> {
    const modelName = options?.model?.trim() || this.defaultModel;

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

      const message =
        error instanceof Error ? error.message : 'Unknown Gemini API error';

      throw new ServiceUnavailableException(
        `Gemini API request failed (model=${modelName}): ${message}`,
      );
    }
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
