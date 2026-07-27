import { BadRequestException, Injectable } from '@nestjs/common';
import { ZodError } from 'zod';
import {
  aiEditUiResponseSchema,
  type AiEditUiResponse,
} from './ai-response.schema';

@Injectable()
export class AiValidatorService {
  validateRawResponse(raw: string): Record<string, unknown> {
    const parsed = this.parseJson(raw);
    const validated = this.validateWithZod(parsed);
    return this.toNormalizedRecord(validated);
  }

  private parseJson(raw: string): unknown {
    const trimmed = raw?.trim();
    if (!trimmed) {
      throw new BadRequestException('AI response is empty; expected JSON.');
    }

    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new BadRequestException(
        'AI response is not valid JSON. Expected a JSON object with no markdown or code fences.',
      );
    }
  }

  private validateWithZod(parsed: unknown): AiEditUiResponse {
    try {
      return aiEditUiResponseSchema.parse(parsed);
    } catch (error) {
      if (error instanceof ZodError) {
        const details = error.issues
          .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
            return `${path}: ${issue.message}`;
          })
          .join('; ');

        throw new BadRequestException(
          `AI response failed schema validation: ${details}`,
        );
      }

      throw new BadRequestException(
        'AI response failed schema validation for an unknown reason.',
      );
    }
  }

  private toNormalizedRecord(
    validated: AiEditUiResponse,
  ): Record<string, unknown> {
    return {
      schema: validated.schema,
    };
  }
}
