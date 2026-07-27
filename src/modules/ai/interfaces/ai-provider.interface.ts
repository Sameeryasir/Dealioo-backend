export interface AiProvider {
  readonly name: string;

  complete(prompt: string, options?: AiProviderCompleteOptions): Promise<string>;
}

export type AiProviderCompleteOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

export const AI_PROVIDER = Symbol('AI_PROVIDER');
