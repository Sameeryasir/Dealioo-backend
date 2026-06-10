import type { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import type { AutomationExecutionPlan } from './automation-flow.service';
import type {
  EmailRecipient,
  PreparedAutomationEmail,
} from './automation-email.types';

export type UnpaidReminderBatchJob = {
  executionId: number;
  restaurantId: number;
  emailNodeId: number;
  conditionNodeId: number;
  purpose: AutomationPurpose;
  prepared: PreparedAutomationEmail;
  plan: AutomationExecutionPlan;
  recipients: EmailRecipient[];
  /** Cron-scheduled runs stay on the trigger node for step display / Pusher stepType. */
  anchorStepOnTrigger: boolean;
};

export type ProcessExecutionJob = {
  executionId: number;
  nodeId: number;
};

export type ResumeExecutionJob = {
  executionId: number;
};

export type CronTickJob = {
  automationId: number;
};
