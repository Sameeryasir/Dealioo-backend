import type { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import type { AutomationExecutionPlan } from './automation-flow.service';
import type {
  EmailRecipient,
  PreparedAutomationEmail,
} from './automation-email.types';

export type UnpaidReminderBatchPhase = 'payment' | 'pass';

export function unpaidReminderBatchJobId(
  executionId: number,
  phase: UnpaidReminderBatchPhase = 'payment',
  chunkIndex = 0,
): string {
  return `unpaid-reminder-batch-${executionId}-${phase}-chunk-${chunkIndex}`;
}

export function unpaidReminderBatchJobIdPrefix(
  executionId: number,
  phase?: UnpaidReminderBatchPhase,
): string {
  if (phase) {
    return `unpaid-reminder-batch-${executionId}-${phase}`;
  }
  return `unpaid-reminder-batch-${executionId}-`;
}

export type UnpaidReminderBatchJob = {
  executionId: number;
  automationId: number;
  businessId: number;
  funnelId: number;
  campaignId: number | null;
  emailNodeId: number;
  conditionNodeId: number;
  purpose: AutomationPurpose;
  prepared: PreparedAutomationEmail | null;
  plan: AutomationExecutionPlan;
  customerIds?: number[];
  recipients: EmailRecipient[];
  chunkIndex?: number;
  totalChunks?: number;
  anchorStepOnTrigger: boolean;
  batchPhase?: UnpaidReminderBatchPhase;
  passPrepared?: PreparedAutomationEmail | null;
  passEmailNodeId?: number | null;
  waitBeforePassNodeId?: number | null;
  waitDelayMs?: number;
};

export type ProcessExecutionJob = {
  executionId: number;
  nodeId: number;
  nodeType?: string;
};

export type ResumeExecutionJob = {
  executionId: number;
};

export type CronTickJob = {
  automationId: number;
};
