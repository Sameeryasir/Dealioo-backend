import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AiSchemaVersion } from './ai-schema-version';
import {
  AI_VERSION_STORE,
  type AiVersionStore,
} from './ai-version-store.interface';

export type CreateVersionInput = {
  businessId: number;
  funnelId?: number;
  schema: Record<string, unknown>;
  operationId: string;
};

/**
 * Creates schema version records for AI Funnel Editor edits.
 * Generates IDs and version payloads; persistence goes through {@link AiVersionStore}.
 */
@Injectable()
export class VersionService {
  constructor(
    @Inject(AI_VERSION_STORE)
    private readonly versionStore: AiVersionStore,
  ) {}

  /**
   * Builds a new schema version and delegates persistence to the store port.
   *
   * @param input - Tenant, funnel, schema snapshot, and AI operation id.
   * @returns The generated `versionId` only.
   */
  async createVersion(
    input: CreateVersionInput,
  ): Promise<{ versionId: string }> {
    const versionId = this.generateVersionId();
    const version = this.buildVersion(versionId, input);
    await this.versionStore.save(version);
    return { versionId };
  }

  /**
   * Generates a unique version identifier.
   */
  private generateVersionId(): string {
    return randomUUID();
  }

  /**
   * Assembles an immutable-style version object from the create input.
   * Clones `schema` so callers cannot mutate the stored snapshot by reference.
   */
  private buildVersion(
    versionId: string,
    input: CreateVersionInput,
  ): AiSchemaVersion {
    return {
      versionId,
      businessId: input.businessId,
      ...(input.funnelId != null ? { funnelId: input.funnelId } : {}),
      schema: structuredClone(input.schema),
      operationId: input.operationId,
      createdAt: new Date().toISOString(),
    };
  }
}
