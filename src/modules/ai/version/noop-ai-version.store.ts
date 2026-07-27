import { Injectable } from '@nestjs/common';
import type { AiSchemaVersion } from './ai-schema-version';
import type { AiVersionStore } from './ai-version-store.interface';

/**
 * No-op store used until a TypeORM (or other) repository is wired.
 * Keeps {@link VersionService} database-agnostic.
 */
@Injectable()
export class NoopAiVersionStore implements AiVersionStore {
  async save(_version: AiSchemaVersion): Promise<void> {
    return;
  }
}
