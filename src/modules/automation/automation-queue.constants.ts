export const AUTOMATION_QUEUE = 'automation';

export const DEFAULT_AUTOMATION_QUEUE_CONCURRENCY = 100;

export function resolveAutomationQueueConcurrency(): number {
  const parsed = parseInt(
    process.env.AUTOMATION_QUEUE_CONCURRENCY ??
      String(DEFAULT_AUTOMATION_QUEUE_CONCURRENCY),
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_AUTOMATION_QUEUE_CONCURRENCY;
  }
  return Math.min(parsed, 500);
}

export enum AutomationJobName {
  UNPAID_REMINDER_BATCH = 'unpaid-reminder-batch',
  PROCESS_EXECUTION = 'process-execution',
  RESUME_EXECUTION = 'resume-execution',
  CRON_TICK = 'cron-tick',
  HANDLE_FUNNEL_EVENT = 'handle-funnel-event',
}

export function resolveAutomationQueueLimiter():
  | { max: number; duration: number }
  | undefined {
  const maxRaw = process.env.AUTOMATION_QUEUE_RATE_MAX?.trim();
  const durationRaw = process.env.AUTOMATION_QUEUE_RATE_DURATION_MS?.trim();
  const max = maxRaw ? parseInt(maxRaw, 10) : 250;
  const duration = durationRaw ? parseInt(durationRaw, 10) : 1000;
  if (!Number.isFinite(max) || max < 1) {
    return { max: 250, duration: 1000 };
  }
  if (!Number.isFinite(duration) || duration < 100) {
    return { max, duration: 1000 };
  }
  return { max, duration };
}

export function automationCronSchedulerKey(automationId: number): string {
  return `automation-cron:${automationId}`;
}

export const AUTOMATION_JOB_CLEANUP_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;
