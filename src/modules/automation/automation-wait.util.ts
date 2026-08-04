/** Reads wait delay from node config (`delayMinutes` or `delay` + `unit`). */
export function resolveWaitDelayMinutes(
  config: Record<string, unknown>,
): number {
  const waitMode = String(config.waitMode ?? '').trim().toLowerCase();
  if (
    waitMode === 'until_customer_visited' ||
    waitMode === 'until_visit_date' ||
    waitMode === 'until_time' ||
    waitMode === 'until_day_of_week'
  ) {
    return 0;
  }

  const untilLabel = String(config.untilLabel ?? '').trim().toLowerCase();
  if (untilLabel.includes('visit date')) {
    return 0;
  }
  if (
    untilLabel.includes('next day') ||
    untilLabel.includes('at ') ||
    untilLabel.includes('am') ||
    untilLabel.includes('pm')
  ) {
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

export function isParallelSplitConfig(
  config: Record<string, unknown>,
): boolean {
  if (config.isParallelSplit === true) {
    return true;
  }
  return Array.isArray(config.branches) && config.branches.length > 1;
}

export type ParsedClockTime = { hours: number; minutes: number };

export function parseClockTime(
  config: Record<string, unknown>,
): ParsedClockTime | null {
  const raw = String(config.time ?? config.untilTime ?? '')
    .trim()
    .toLowerCase();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  if (minutes < 0 || minutes > 59 || hours < 0 || hours > 23) {
    return null;
  }

  if (meridiem === 'am' || meridiem === 'pm') {
    if (hours < 1 || hours > 12) {
      return null;
    }
    if (meridiem === 'am') {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }
  }

  return { hours, minutes };
}

function parseDayOfWeek(config: Record<string, unknown>): number | null {
  const raw = String(
    config.dayOfWeek ?? config.weekday ?? config.untilDayOfWeek ?? '',
  )
    .trim()
    .toLowerCase();
  if (!raw) {
    const label = String(config.untilLabel ?? '').trim().toLowerCase();
    const days = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const found = days.findIndex((day) => label.includes(day));
    return found >= 0 ? found : null;
  }

  const named: Record<string, number> = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
  };
  if (raw in named) {
    return named[raw]!;
  }
  const asNum = Number(raw);
  if (Number.isInteger(asNum) && asNum >= 0 && asNum <= 6) {
    return asNum;
  }
  return null;
}

function atLocalTime(base: Date, hours: number, minutes: number): Date {
  const target = new Date(base);
  target.setHours(hours, minutes, 0, 0);
  return target;
}

/**
 * Absolute resume time for wait nodes. Returns null when there is no delay
 * (including parallel splits with delay 0).
 */
export function resolveWaitResumeAt(
  config: Record<string, unknown>,
  now: Date = new Date(),
): Date | null {
  const delayMinutes = resolveWaitDelayMinutes(config);
  if (delayMinutes > 0) {
    return new Date(now.getTime() + delayMinutes * 60_000);
  }

  if (isParallelSplitConfig(config)) {
    return null;
  }

  const waitMode = String(config.waitMode ?? '').trim().toLowerCase();
  const untilLabel = String(config.untilLabel ?? '').trim().toLowerCase();
  const clock = parseClockTime(config);

  if (
    waitMode === 'until_day_of_week' ||
    (clock && parseDayOfWeek(config) != null)
  ) {
    const day = parseDayOfWeek(config);
    if (day == null || !clock) {
      return null;
    }
    const candidate = atLocalTime(now, clock.hours, clock.minutes);
    const delta = (day - candidate.getDay() + 7) % 7;
    if (delta === 0 && candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 7);
    } else {
      candidate.setDate(candidate.getDate() + delta);
    }
    return candidate;
  }

  if (
    waitMode === 'until_time' ||
    untilLabel.includes('next day') ||
    (clock && (untilLabel.includes('at ') || untilLabel.includes('am') || untilLabel.includes('pm')))
  ) {
    if (!clock) {
      return null;
    }
    if (untilLabel.includes('next day') || waitMode === 'until_time') {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return atLocalTime(tomorrow, clock.hours, clock.minutes);
    }
    const today = atLocalTime(now, clock.hours, clock.minutes);
    if (today.getTime() > now.getTime()) {
      return today;
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return atLocalTime(tomorrow, clock.hours, clock.minutes);
  }

  return null;
}
