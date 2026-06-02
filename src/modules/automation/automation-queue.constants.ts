export const AUTOMATION_QUEUE = 'automation';

export const MAX_AUTOMATION_EXECUTION_STEPS = 50;

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
