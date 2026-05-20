import { AutomationExecutionStatus } from '../../../db/entities/automation-execution.entity';

export class AutomationExecutionStatusDto {
  executionId: number;
  automationId: number;
  status: AutomationExecutionStatus;
  /** True when status is completed or failed — frontend can stop polling. */
  isTerminal: boolean;
  totalRecipients: number;
  emailsSent: number;
  /** 0–100 when totalRecipients > 0; otherwise 0 until completed. */
  progressPercent: number;
  queueJobId: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class StartAutomationExecutionResponseDto {
  status: AutomationExecutionStatusDto;
}

export class ExecuteAutomationResponseDto {
  executionId: number;
  status: AutomationExecutionStatus;
  isTerminal: boolean;
  unpaidCount: number;
  totalRecipients: number;
  emailsSent: number;
  progressPercent: number;
}
