export const AUTOMATION_WAIT_POLL_INTERVAL_MS = 10_000;

export function shouldUseDbWaitScheduler(delayMs: number): boolean {
  return delayMs > 0;
}

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
