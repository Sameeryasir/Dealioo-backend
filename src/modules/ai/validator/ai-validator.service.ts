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
    const normalized = this.normalizeShape(parsed);
    const validated = this.validateWithZod(normalized);
    return this.toNormalizedRecord(validated);
  }

  private parseJson(raw: string): unknown {
    const trimmed = this.stripCodeFences(raw?.trim() ?? '');
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

  private stripCodeFences(raw: string): string {
    const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced?.[1]?.trim() || raw;
  }

  private normalizeShape(parsed: unknown): unknown {
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return parsed;
    }

    const obj = parsed as Record<string, unknown>;

    if ('schema' in obj) {
      return obj;
    }

    if (
      'updates' in obj &&
      typeof obj.updates === 'object' &&
      obj.updates !== null &&
      !Array.isArray(obj.updates)
    ) {
      return {
        schema: obj.updates,
        ...(typeof obj.success === 'boolean' ? { success: obj.success } : {}),
        ...(typeof obj.message === 'string' ? { message: obj.message } : {}),
      };
    }

    if (typeof obj.message === 'string' || typeof obj.success === 'boolean') {
      const { message, success, ...fields } = obj;
      return {
        schema: fields,
        ...(typeof success === 'boolean' ? { success } : {}),
        ...(typeof message === 'string' ? { message } : {}),
      };
    }

    return { schema: obj };
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
      ...(validated.success != null ? { success: validated.success } : {}),
      ...(validated.message != null ? { message: validated.message } : {}),
    };
  }
}
