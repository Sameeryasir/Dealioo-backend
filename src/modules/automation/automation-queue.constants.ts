export const AUTOMATION_QUEUE = 'automation';

export const DEFAULT_AUTOMATION_QUEUE_CONCURRENCY = 50;

export function resolveAutomationQueueConcurrency(): number {
  const parsed = parseInt(
    process.env.AUTOMATION_QUEUE_CONCURRENCY ??
      String(DEFAULT_AUTOMATION_QUEUE_CONCURRENCY),
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_AUTOMATION_QUEUE_CONCURRENCY;
  }
  return parsed;
}

export enum AutomationJobName {
  UNPAID_REMINDER_BATCH = 'unpaid-reminder-batch',
  PROCESS_EXECUTION = 'process-execution',
  RESUME_EXECUTION = 'resume-execution',
  CRON_TICK = 'cron-tick',
}

export function automationCronSchedulerKey(automationId: number): string {
  return `automation-cron:${automationId}`;
}

export const AUTOMATION_JOB_CLEANUP_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;
