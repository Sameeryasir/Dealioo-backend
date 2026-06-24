/** Reads wait delay from node config (`delayMinutes` or `delay` + `unit`). */
export function resolveWaitDelayMinutes(
  config: Record<string, unknown>,
): number {
  const waitMode = String(config.waitMode ?? '').trim().toLowerCase();
  if (
    waitMode === 'until_customer_visited' ||
    waitMode === 'until_visit_date'
  ) {
    return 0;
  }

  const untilLabel = String(config.untilLabel ?? '').trim().toLowerCase();
  if (untilLabel.includes('visit date')) {
    return 0;
  }

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
