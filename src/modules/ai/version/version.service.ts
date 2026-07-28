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
  changedPages?: Record<string, unknown>;
  operationId: string;
};

@Injectable()
export class VersionService {
  constructor(
    @Inject(AI_VERSION_STORE)
    private readonly versionStore: AiVersionStore,
  ) {}

  async createVersion(
    input: CreateVersionInput,
  ): Promise<{ versionId: string }> {
    const versionId = this.generateVersionId();
    const version = this.buildVersion(versionId, input);
    await this.versionStore.save(version);
    return { versionId };
  }

  private generateVersionId(): string {
    return randomUUID();
  }

  private buildVersion(
    versionId: string,
    input: CreateVersionInput,
  ): AiSchemaVersion {
    return {
      versionId,
      businessId: input.businessId,
      ...(input.funnelId != null ? { funnelId: input.funnelId } : {}),
      schema: structuredClone(input.schema),
      ...(input.changedPages != null
        ? { changedPages: structuredClone(input.changedPages) }
        : {}),
      operationId: input.operationId,
      createdAt: new Date().toISOString(),
    };
  }
}
