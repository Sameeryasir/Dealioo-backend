import type { AutomationExecutionStatus } from '../../db/entities/automation-execution.entity';
import type {
  ConversationMessageDto,
  ConversationMessageKind,
} from '../chat/chat.dto';

/** Payload when a run reaches a terminal state (completed or failed). */
export type ExecutionTerminalPusherPayload = {
  executionId: number;
  automationId: number;
  status: AutomationExecutionStatus;
  isTerminal: true;
  totalRecipients: number;
  emailsSent: number;
  progressPercent: number;
  queueJobId: string | null;
  lastError: string | null;
  finishedAt: string;
  /** Current automation node type at terminal state (e.g. email, trigger). */
  stepType: string | null;
};

/** Payload when an automation message is saved to a guest conversation. */
export type ChatMessagePusherPayload = {
  restaurantId: number;
  customerId: number;
  customerName: string | null;
  customerEmail: string | null;
  message: Omit<ConversationMessageDto, 'sentAt'> & { sentAt: string };
  lastMessagePreview: string;
  lastMessageChannel: ConversationMessageKind;
  lastMessageAt: string;
  messageCount: number;
};
