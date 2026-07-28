import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FunnelPageType,
  isFunnelPageType,
} from '../../db/entities/funnel-page-type';
import { FunnelPagesService } from '../funnel-pages/funnel-pages.service';
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
    private readonly funnelPagesService: FunnelPagesService,
  ) {}

  async editUi(dto: EditUiDto): Promise<AiResponseDto> {
    const operationId = randomUUID();
    const correlationId = dto.correlationId?.trim() || randomUUID();

    try {
      const pageId =
        dto.pageId && isFunnelPageType(dto.pageId) ? dto.pageId : undefined;
      const affectedTypes = pageId
        ? [pageId]
        : this.funnelPagesService.resolveAffectedPageTypes(
            dto.pageId,
            dto.userInstruction,
          );

      let pageBase: Record<string, unknown> = {};
      if (dto.funnelId != null && pageId) {
        const loaded = await this.funnelPagesService.loadSubsetPages(
          dto.funnelId,
          [pageId],
        );
        pageBase = this.asObject(loaded[pageId]);
      } else if (dto.funnelId != null) {
        const loaded = await this.funnelPagesService.loadSubsetPages(
          dto.funnelId,
          affectedTypes,
        );
        pageBase = this.asObject(loaded[affectedTypes[0]]);
      }

      const editableFields =
        dto.editableFields != null && Object.keys(dto.editableFields).length > 0
          ? structuredClone(dto.editableFields)
          : this.fallbackEditableFields(pageBase);

      pageBase = this.schemaEngine.applyPatch(pageBase, editableFields);

      const context = this.buildPromptContext(dto, editableFields);
      const prompt = this.promptBuilder.buildPrompt(context);
      const rawResponse = await this.aiProvider.complete(prompt);
      const validated = this.validator.validateRawResponse(rawResponse);
      const fieldPatch = this.extractFieldPatch(
        validated,
        pageId,
        editableFields,
        dto.fieldConstraints,
      );

      const aiSuccess =
        typeof validated.success === 'boolean' ? validated.success : undefined;

      if (aiSuccess === false || Object.keys(fieldPatch).length === 0) {
        return {
          success: false,
          message:
            typeof validated.message === 'string' && validated.message.trim()
              ? validated.message.trim()
              : 'Could not complete that edit with the provided fields.',
          operationId,
          correlationId,
        };
      }

      const targetPageId =
        pageId ??
        affectedTypes[0] ??
        FunnelPageType.LANDING;

      const mergedPage = this.schemaEngine.applyPatch(pageBase, fieldPatch);
      const changedOnly: Record<string, unknown> = {
        [targetPageId]: mergedPage,
      };

      let baseFull: Record<string, unknown>;
      if (dto.funnelId != null) {
        baseFull = await this.funnelPagesService.loadAssembledPages(
          dto.funnelId,
        );
      } else {
        baseFull = { [targetPageId]: pageBase };
      }
      const schema = this.schemaEngine.applyPatch(baseFull, changedOnly);

      const message =
        typeof validated.message === 'string' && validated.message.trim()
          ? validated.message.trim()
          : `Updated ${Object.keys(fieldPatch).join(', ')} on ${targetPageId}.`;

      await this.versionService.createVersion({
        businessId: dto.businessId,
        funnelId: dto.funnelId,
        schema,
        changedPages: changedOnly,
        operationId,
      });

      const responseSchema =
        dto.funnelId != null
          ? await this.funnelPagesService.loadAssembledPages(dto.funnelId)
          : schema;

      return {
        success: true,
        schema: responseSchema,
        message,
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

  private buildPromptContext(
    dto: EditUiDto,
    editableFields: Record<string, unknown>,
  ): PromptContext {
    return {
      businessId: dto.businessId,
      ...(dto.campaignId != null ? { campaignId: dto.campaignId } : {}),
      ...(dto.funnelId != null ? { funnelId: dto.funnelId } : {}),
      ...(dto.pageId != null && dto.pageId !== ''
        ? { pageId: dto.pageId }
        : {}),
      editableFields,
      ...(dto.fieldConstraints != null
        ? { fieldConstraints: dto.fieldConstraints }
        : {}),
      userInstruction: dto.userInstruction,
    };
  }

  private extractFieldPatch(
    validated: Record<string, unknown>,
    pageId: FunnelPageType | undefined,
    editableFields: Record<string, unknown>,
    fieldConstraints?: Record<string, string[]>,
  ): Record<string, unknown> {
    const raw = validated.schema;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BadRequestException(
        'AI response is missing a field patch object.',
      );
    }

    const candidate = raw as Record<string, unknown>;

    if (
      pageId &&
      pageId in candidate &&
      typeof candidate[pageId] === 'object' &&
      candidate[pageId] !== null &&
      !Array.isArray(candidate[pageId])
    ) {
      return this.filterToEditableKeys(
        candidate[pageId] as Record<string, unknown>,
        editableFields,
        fieldConstraints,
      );
    }

    if (
      !('schema' in candidate) &&
      Object.keys(candidate).some((key) => isFunnelPageType(key))
    ) {
      const firstPage = Object.keys(candidate).find(isFunnelPageType);
      if (
        firstPage &&
        typeof candidate[firstPage] === 'object' &&
        candidate[firstPage] !== null
      ) {
        return this.filterToEditableKeys(
          candidate[firstPage] as Record<string, unknown>,
          editableFields,
          fieldConstraints,
        );
      }
    }

    return this.filterToEditableKeys(
      candidate,
      editableFields,
      fieldConstraints,
    );
  }

  private filterToEditableKeys(
    patch: Record<string, unknown>,
    editableFields: Record<string, unknown>,
    fieldConstraints?: Record<string, string[]>,
  ): Record<string, unknown> {
    const allowed = new Set(Object.keys(editableFields));
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (
        key === 'message' ||
        key === 'updates' ||
        key === 'schema' ||
        key === 'success'
      ) {
        continue;
      }
      if (allowed.size === 0 || allowed.has(key)) {
        const constrained = fieldConstraints?.[key];
        if (constrained != null && constrained.length > 0) {
          if (typeof value !== 'string' || !constrained.includes(value)) {
            continue;
          }
        }
        filtered[key] = value;
      }
    }
    return filtered;
  }

  private fallbackEditableFields(
    page: Record<string, unknown>,
  ): Record<string, unknown> {
    const keys = [
      'pageTitle',
      'headline',
      'subheadline',
      'body',
      'ctaLabel',
    ] as const;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in page) {
        out[key] = page[key];
      }
    }
    return out;
  }

  private asObject(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return structuredClone(value as Record<string, unknown>);
    }
    return {};
  }
}
