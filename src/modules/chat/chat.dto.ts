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

export class ConversationMessageDto {
  id: number;
  kind: ConversationMessageKind;
  direction: ConversationMessageDirection;
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
