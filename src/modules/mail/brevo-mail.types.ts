export type BrevoAutomationEmailPayload = {
  to: string;
  toName?: string;
  subject?: string;
  html?: string;
  text?: string;
  templateId?: number;
  params?: Record<string, unknown>;
  tags?: string[];
};

export type BrevoBulkRecipient = {
  email: string;
  name?: string;
  html?: string;
  text?: string;
  params?: Record<string, unknown>;
};

export type BrevoBulkSendOptions = {
  recipients: BrevoBulkRecipient[];
  subject: string;
  templateId?: number;
  tags?: string[];
};

export type BrevoSendResult = {
  messageId?: string;
};

export type BrevoBulkSendResult = {
  messageIds: string[];
  recipientCount: number;
  requestCount: number;
};

export type BrevoTransactionalContent = {
  subject: string;
  html: string;
  text?: string;
};
