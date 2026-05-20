import type { AutomationEmailTemplateProps } from '../../templates/automation/types';
import type { AutomationNode } from '../../db/entities/automation-node.entity';

export type UnpaidReminderBatchJob = {
  executionId: number;
  emailNodeId: number;
  conditionNodeId: number;
  subject: string;
  templateKey: string;
  templateProps: Partial<AutomationEmailTemplateProps>;
  plan: {
    nodes: AutomationNode[];
    emailNode: AutomationNode | null;
    conditionNode: AutomationNode | null;
  };
  recipients: { customerId: number; email: string; name: string }[];
};

export type ProcessExecutionJob = {
  executionId: number;
  nodeId: number;
};

export type ResumeExecutionJob = {
  executionId: number;
};
