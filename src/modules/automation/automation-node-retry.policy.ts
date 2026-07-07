import { AutomationNodeType } from '../../db/entities/automation-node.entity';

export type AutomationJobRetryPolicy = {
  attempts: number;
  backoff?: {
    type: 'exponential' | 'fixed';
    delay: number;
  };
};

const DEFAULT_POLICY: AutomationJobRetryPolicy = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 3000 },
};

const NODE_RETRY_POLICIES: Partial<
  Record<AutomationNodeType, AutomationJobRetryPolicy>
> = {
  [AutomationNodeType.EMAIL]: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  },
  [AutomationNodeType.SMS]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 4000 },
  },
  [AutomationNodeType.WHATSAPP]: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 4000 },
  },
  [AutomationNodeType.CONDITION]: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
  },
  [AutomationNodeType.WAIT]: {
    attempts: 1,
  },
  [AutomationNodeType.TRIGGER]: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 1000 },
  },
};

export function resolveProcessExecutionRetryPolicy(
  nodeType?: AutomationNodeType | null,
): AutomationJobRetryPolicy {
  if (!nodeType) {
    return DEFAULT_POLICY;
  }
  return NODE_RETRY_POLICIES[nodeType] ?? DEFAULT_POLICY;
}

export function resolveResumeExecutionRetryPolicy(): AutomationJobRetryPolicy {
  return { attempts: 1 };
}

export function resolveJobAttempts(
  nodeType?: AutomationNodeType | null,
  jobName?: 'process-execution' | 'resume-execution',
): number {
  if (jobName === 'resume-execution') {
    return resolveResumeExecutionRetryPolicy().attempts;
  }
  return resolveProcessExecutionRetryPolicy(nodeType).attempts;
}
