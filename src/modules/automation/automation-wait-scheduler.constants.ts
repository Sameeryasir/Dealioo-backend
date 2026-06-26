export const DEFAULT_DB_WAIT_SCHEDULER_THRESHOLD_MS = 5 * 60 * 1000;

export function resolveDbWaitSchedulerThresholdMs(): number {
  const raw = process.env.AUTOMATION_DB_WAIT_THRESHOLD_MS?.trim();
  if (!raw) {
    return DEFAULT_DB_WAIT_SCHEDULER_THRESHOLD_MS;
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_DB_WAIT_SCHEDULER_THRESHOLD_MS;
  }
  return parsed;
}

export function shouldUseDbWaitScheduler(delayMs: number): boolean {
  return delayMs >= resolveDbWaitSchedulerThresholdMs();
}

export const AUTOMATION_WAIT_POLL_INTERVAL_MS = 60_000;

export function resolveWaitPollIntervalMs(): number {
  const raw = process.env.AUTOMATION_WAIT_POLL_INTERVAL_MS?.trim();
  if (!raw) {
    return AUTOMATION_WAIT_POLL_INTERVAL_MS;
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 10_000) {
    return AUTOMATION_WAIT_POLL_INTERVAL_MS;
  }
  return parsed;
}
