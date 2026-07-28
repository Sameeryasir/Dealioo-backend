export type AiSchemaVersion = {
  versionId: string;
  businessId: number;
  funnelId?: number;
  schema: Record<string, unknown>;
  changedPages?: Record<string, unknown>;
  operationId: string;
  createdAt: string;
};
