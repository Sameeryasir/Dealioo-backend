export const AUTOMATION_WAIT_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_AUTOMATION_WAIT_BATCH_SIZE = 250;

export function shouldUseDbWaitScheduler(delayMs: number): boolean {
  return delayMs > 0;
}

export function resolveWaitPollIntervalMs(): number {
  const raw = process.env.AUTOMATION_WAIT_POLL_INTERVAL_MS?.trim();
  if (!raw) {
    return AUTOMATION_WAIT_POLL_INTERVAL_MS;
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 5_000) {
    return AUTOMATION_WAIT_POLL_INTERVAL_MS;
  }
  return parsed;
}

export function resolveWaitPollBatchSize(): number {
  const raw = process.env.AUTOMATION_WAIT_BATCH_SIZE?.trim();
  if (!raw) {
    return DEFAULT_AUTOMATION_WAIT_BATCH_SIZE;
  }
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 50) {
    return DEFAULT_AUTOMATION_WAIT_BATCH_SIZE;
  }
  return Math.min(parsed, 1000);
}
