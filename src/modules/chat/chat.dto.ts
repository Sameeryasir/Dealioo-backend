import type { PaginationMeta } from '../../common/pagination';
import { AutomationExecutionStatus } from '../../db/entities/automation-execution.entity';

export class ActiveFlowCustomerDto {
  executionId: number;
  customerId: number;
  customerName: string | null;
  customerEmail: string | null;
  automationId: number;
  automationName: string;
  status: AutomationExecutionStatus;
  stepType: string | null;
  scheduledAt: Date | null;
  startedAt: Date;
  updatedAt: Date;
}

export class PaginatedActiveFlowCustomersDto {
  data: ActiveFlowCustomerDto[];
  meta: PaginationMeta;
}

export type ConversationMessageKind =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'system'
  | 'error';

export type ConversationMessageDirection = 'outbound' | 'system';

export class ConversationMessageParticipantDto {
  type: 'restaurant' | 'customer';
  id: number;
  name: string | null;
  email: string | null;
}

export class ConversationMessageDto {
  id: number;
  kind: ConversationMessageKind;
  direction: ConversationMessageDirection;
  sentBy: ConversationMessageParticipantDto | null;
  sentTo: ConversationMessageParticipantDto | null;
  body: string;
  stepType: string | null;
  sentAt: Date;
  error: string | null;
}

export class ConversationDetailDto {
  executionId: number;
  customerId: number;
  customerName: string | null;
  customerEmail: string | null;
  automationId: number;
  automationName: string;
  status: AutomationExecutionStatus;
  stepType: string | null;
  scheduledAt: Date | null;
  startedAt: Date;
  updatedAt: Date;
  messages: ConversationMessageDto[];
}

/** Guest row for Chats sidebar — one private conversation thread per guest. */
export class ChatCustomerSummaryDto {
  customerId: number;
  customerName: string | null;
  customerEmail: string | null;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageChannel: ConversationMessageKind;
  lastMessageAt: Date;
  lastAutomationName: string | null;
}

export class PaginatedChatCustomersDto {
  data: ChatCustomerSummaryDto[];
  meta: PaginationMeta;
}

/** Full message thread for one guest at a restaurant. */
export class CustomerConversationDetailDto {
  customerId: number;
  customerName: string | null;
  customerEmail: string | null;
  messages: ConversationMessageDto[];
}
