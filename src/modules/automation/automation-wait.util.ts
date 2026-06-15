/** Reads wait delay from node config (`delayMinutes` or `delay` + `unit`). */
export function resolveWaitDelayMinutes(
  config: Record<string, unknown>,
): number {
  const direct = Number(config.delayMinutes);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const delay = Number(config.delay);
  if (!Number.isFinite(delay) || delay <= 0) {
    return 0;
  }

  const unit = String(config.unit ?? 'minutes').trim().toLowerCase();
  if (unit.startsWith('hour')) {
    return delay * 60;
  }
  if (unit.startsWith('day')) {
    return delay * 60 * 24;
  }
  return delay;
}
