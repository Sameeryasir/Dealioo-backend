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
): string {
  return `unpaid-reminder-batch-${executionId}-${phase}`;
}

export type UnpaidReminderBatchJob = {
  executionId: number;
  restaurantId: number;
  funnelId: number;
  campaignId: number | null;
  emailNodeId: number;
  conditionNodeId: number;
  purpose: AutomationPurpose;
  prepared: PreparedAutomationEmail | null;
  plan: AutomationExecutionPlan;
  recipients: EmailRecipient[];
  /** Cron-scheduled runs stay on the trigger node for step display / Pusher stepType. */
  anchorStepOnTrigger: boolean;
  /** Which email step this batch job sends. */
  batchPhase?: UnpaidReminderBatchPhase;
  /** Follow-up pass email prepared content (payment phase only). */
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
