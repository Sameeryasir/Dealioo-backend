import type { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import type { AutomationNode } from '../../db/entities/automation-node.entity';
import type {
  EmailRecipient,
  PreparedAutomationEmail,
} from './automation-email.types';

export type UnpaidReminderBatchJob = {
  executionId: number;
  emailNodeId: number;
  conditionNodeId: number;
  purpose: AutomationPurpose;
  prepared: PreparedAutomationEmail;
  plan: {
    nodes: AutomationNode[];
    emailNode: AutomationNode | null;
    conditionNode: AutomationNode | null;
  };
  recipients: EmailRecipient[];
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
