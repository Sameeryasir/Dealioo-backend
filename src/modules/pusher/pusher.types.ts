import type { AutomationExecutionStatus } from '../../db/entities/automation-execution.entity';

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
