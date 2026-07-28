export interface PromptContext {
  businessId: number;
  campaignId?: number;
  funnelId?: number;
  pageId?: string;
  editableFields?: Record<string, unknown>;
  fieldConstraints?: Record<string, string[]>;
  currentSchema?: Record<string, unknown>;
  userInstruction: string;
  locale?: string;
  brandVoice?: string;
}
