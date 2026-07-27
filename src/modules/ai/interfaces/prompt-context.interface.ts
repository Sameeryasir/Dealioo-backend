export interface PromptContext {
  businessId: number;
  campaignId?: number;
  funnelId?: number;
  pageId?: string;
  currentSchema?: Record<string, unknown>;
  userInstruction: string;
  locale?: string;
  brandVoice?: string;
}
