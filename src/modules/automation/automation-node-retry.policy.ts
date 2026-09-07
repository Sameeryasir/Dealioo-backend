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
    attempts: 8,
    backoff: { type: 'exponential', delay: 15_000 },
  },
  [AutomationNodeType.SMS]: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 12_000 },
  },
  [AutomationNodeType.WHATSAPP]: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 12_000 },
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
  return {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  };
}

export function isLikelyProviderOutageError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('timeout') ||
    normalized.includes('etimedout') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused') ||
    normalized.includes('socket') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('429') ||
    normalized.includes('503') ||
    normalized.includes('502') ||
    normalized.includes('unavailable') ||
    normalized.includes('twilio') ||
    normalized.includes('smtp') ||
    normalized.includes('ses') ||
    normalized.includes('sendgrid') ||
    normalized.includes('provider')
  );
}

export function resolveProviderOutageRetryDelayMs(attempt: number): number {
  const base = 60_000;
  const cappedAttempt = Math.min(Math.max(attempt, 1), 8);
  return Math.min(base * 2 ** (cappedAttempt - 1), 60 * 60_000);
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
