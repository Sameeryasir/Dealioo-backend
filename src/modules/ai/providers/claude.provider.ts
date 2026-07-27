import { Injectable } from '@nestjs/common';
import type {
  AiProvider,
  AiProviderCompleteOptions,
} from '../interfaces/ai-provider.interface';

@Injectable()
export class ClaudeProvider implements AiProvider {
  readonly name = 'claude';

  async complete(
    _prompt: string,
    _options?: AiProviderCompleteOptions,
  ): Promise<string> {
    throw new Error('ClaudeProvider.complete is not implemented yet.');
  }
}
