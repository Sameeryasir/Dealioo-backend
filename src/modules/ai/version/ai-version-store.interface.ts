import type { AiSchemaVersion } from './ai-schema-version';

export const AI_VERSION_STORE = Symbol('AI_VERSION_STORE');

export interface AiVersionStore {
  save(version: AiSchemaVersion): Promise<void>;
}
