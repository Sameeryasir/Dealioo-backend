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

export type ConversationMessageDirection = 'outbound' | 'inbound' | 'system';

export class ConversationMessageParticipantDto {
  type: 'business' | 'customer';
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

export class ChatCustomerSummaryDto {
  conversationId: number;
  customerId: number;
  customerName: string | null;
  customerEmail: string | null;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageChannel: ConversationMessageKind;
  lastMessageAt: Date;
  lastAutomationName: string | null;
  createdAt: Date;
}

export class PaginatedChatCustomersDto {
  data: ChatCustomerSummaryDto[];
  meta: PaginationMeta;
}

export class SyncChatCustomersDto {
  data: ChatCustomerSummaryDto[];
}

export class GuestConversationDto {
  conversationId: number;
  customerId: number;
  customerName: string | null;
  customerEmail: string | null;
  messageCount: number;
  lastMessagePreview: string;
  lastMessageChannel: ConversationMessageKind | null;
  lastMessageAt: Date | null;
  lastAutomationName: string | null;
  createdAt: Date;
}

export class CustomerConversationMessagesDto {
  conversationId: number;
  customerId: number;
  messages: ConversationMessageDto[];
}

export class SyncChatMessagesThreadDto {
  conversationId: number;
  customerId: number;
  messages: ConversationMessageDto[];
}

export class SyncChatMessagesDto {
  data: SyncChatMessagesThreadDto[];
}

export class ChatUnreadSummaryDto {
  hasUnread: boolean;
  unreadCount: number;
  chatsLastViewedAt: Date | null;
}
