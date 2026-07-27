import { Injectable } from '@nestjs/common';
import type {
  AiProvider,
  AiProviderCompleteOptions,
} from '../interfaces/ai-provider.interface';

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  async complete(
    _prompt: string,
    _options?: AiProviderCompleteOptions,
  ): Promise<string> {
    throw new Error('OpenAiProvider.complete is not implemented yet.');
  }
}
