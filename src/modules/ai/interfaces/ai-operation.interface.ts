export type AiOperationType = 'edit_ui' | 'rewrite_copy' | 'suggest_layout';

export interface AiOperation {
  type: AiOperationType;
  businessId: number;
  campaignId?: number;
  funnelId?: number;
  correlationId?: string;
}
