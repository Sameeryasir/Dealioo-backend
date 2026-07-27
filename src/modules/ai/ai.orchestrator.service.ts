import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AiResponseDto } from './dto/ai-response.dto';
import type { EditUiDto } from './dto/edit-ui.dto';
import {
  AI_PROVIDER,
  type AiProvider,
} from './interfaces/ai-provider.interface';
import type { PromptContext } from './interfaces/prompt-context.interface';
import { PromptBuilderService } from './prompt-builder/prompt-builder.service';
import { SchemaEngineService } from './schema-engine/schema-engine.service';
import { AiValidatorService } from './validator/ai-validator.service';
import { VersionService } from './version/version.service';

@Injectable()
export class AiOrchestratorService {
  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
    private readonly promptBuilder: PromptBuilderService,
    private readonly validator: AiValidatorService,
    private readonly schemaEngine: SchemaEngineService,
    private readonly versionService: VersionService,
  ) {}

  async editUi(dto: EditUiDto): Promise<AiResponseDto> {
    const operationId = randomUUID();
    const correlationId = dto.correlationId?.trim() || randomUUID();

    try {
      const context = this.buildPromptContext(dto);
      const prompt = this.promptBuilder.buildPrompt(context);
      const rawResponse = await this.aiProvider.complete(prompt);
      const validated = this.validator.validateRawResponse(rawResponse);
      const patch = this.extractSchemaPatch(validated);
      const schema = this.schemaEngine.applyPatch(dto.currentSchema, patch);

      await this.versionService.createVersion({
        businessId: dto.businessId,
        funnelId: dto.funnelId,
        schema,
        operationId,
      });

      return {
        success: true,
        schema,
        operationId,
        correlationId,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Unknown orchestration error';

      throw new InternalServerErrorException(
        `AI edit-UI orchestration failed (operationId=${operationId}): ${message}`,
      );
    }
  }

  private buildPromptContext(dto: EditUiDto): PromptContext {
    return {
      businessId: dto.businessId,
      ...(dto.campaignId != null ? { campaignId: dto.campaignId } : {}),
      ...(dto.funnelId != null ? { funnelId: dto.funnelId } : {}),
      ...(dto.pageId != null && dto.pageId !== ''
        ? { pageId: dto.pageId }
        : {}),
      ...(dto.currentSchema != null
        ? { currentSchema: dto.currentSchema }
        : {}),
      userInstruction: dto.userInstruction,
    };
  }

  private extractSchemaPatch(
    validated: Record<string, unknown>,
  ): Record<string, unknown> {
    const patch = validated.schema;

    if (
      typeof patch !== 'object' ||
      patch === null ||
      Array.isArray(patch)
    ) {
      throw new BadRequestException(
        'Validated AI response is missing a schema object patch.',
      );
    }

    return patch as Record<string, unknown>;
  }
}
