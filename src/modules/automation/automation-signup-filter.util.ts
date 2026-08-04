export type SignupFilterCondition = {
  value?: unknown;
  negated?: unknown;
  conditionType?: unknown;
  type?: unknown;
  hours?: unknown;
  amount?: unknown;
  unit?: unknown;
  comparator?: unknown;
};

export function collectSignupFilterConditions(
  config: Record<string, unknown>,
): SignupFilterCondition[] {
  const fromArray = Array.isArray(config.conditions)
    ? (config.conditions as SignupFilterCondition[])
    : [];
  if (fromArray.length > 0) {
    return fromArray;
  }

  const fallback = String(config.conditionType ?? config.type ?? '').trim();
  if (!fallback) {
    return [];
  }
  return [{ value: fallback }];
}

export function normalizeSignupFilterText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export type SignupDelayUnit = 'seconds' | 'minutes' | 'hours' | 'days';

export type SignupTimeComparator = 'gte' | 'lt';

export type SignupFilterKind =
  | 'pass_added'
  | 'reward_redeemed'
  | 'time_since_signup'
  | 'offer_expires_within'
  | 'unknown';

export type ParsedSignupFilter = {
  kind: SignupFilterKind;
  negated: boolean;
  amount?: number;
  unit?: SignupDelayUnit;
  comparator?: SignupTimeComparator;
  hours?: number;
};

const UNIT_MS: Record<SignupDelayUnit, number> = {
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export function normalizeSignupDelayUnit(raw: unknown): SignupDelayUnit | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (
    value === 'seconds' ||
    value === 'second' ||
    value === 'secs' ||
    value === 'sec'
  ) {
    return 'seconds';
  }
  if (
    value === 'minutes' ||
    value === 'minute' ||
    value === 'mins' ||
    value === 'min'
  ) {
    return 'minutes';
  }
  if (value === 'hours' || value === 'hour' || value === 'hrs' || value === 'hr') {
    return 'hours';
  }
  if (value === 'days' || value === 'day') {
    return 'days';
  }
  return null;
}

export function signupDelayToMs(
  amount: number,
  unit: SignupDelayUnit,
): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return amount * UNIT_MS[unit];
}

function normalizeComparator(raw: unknown): SignupTimeComparator | null {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'lt' || value === 'less_than' || value === 'less than') {
    return 'lt';
  }
  if (
    value === 'gte' ||
    value === 'gt' ||
    value === 'over' ||
    value === 'at_least' ||
    value === 'at least'
  ) {
    return 'gte';
  }
  return null;
}

export function parseDurationPhrase(
  text: string,
): { amount: number; unit: SignupDelayUnit } | null {
  const normalized = normalizeSignupFilterText(text);

  const weekMatch = normalized.match(
    /(?:(\d+(?:\.\d+)?)|an?|one)\s*weeks?\b/,
  );
  if (weekMatch) {
    const rawAmount = weekMatch[1];
    const weeks = rawAmount ? Number(rawAmount) : 1;
    if (Number.isFinite(weeks) && weeks > 0) {
      return { amount: weeks * 7, unit: 'days' };
    }
  }

  const match = normalized.match(
    /(?:(\d+(?:\.\d+)?)|an?|one)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\b/,
  );
  if (!match) {
    return null;
  }

  const rawAmount = match[1];
  const amount = rawAmount ? Number(rawAmount) : 1;
  const unit = normalizeSignupDelayUnit(match[2]);
  if (!Number.isFinite(amount) || amount <= 0 || !unit) {
    return null;
  }
  return { amount, unit };
}

function isSignupTimeText(core: string): boolean {
  return core.includes('since sign') || core.includes('signed up');
}

function inferTimeComparator(core: string): SignupTimeComparator {
  if (/\b(less than|under)\b/.test(core)) {
    return 'lt';
  }
  return 'gte';
}

export function parseSignupFilterCondition(
  condition: SignupFilterCondition,
): ParsedSignupFilter {
  const rawValue = String(
    condition.value ?? condition.conditionType ?? condition.type ?? '',
  ).trim();
  const normalized = normalizeSignupFilterText(rawValue);
  const explicitNegated = condition.negated === true;
  const textNegated =
    normalized.startsWith('not ') ||
    normalized.startsWith('not_') ||
    normalized.includes(' not ') ||
    normalized.startsWith('pass not ') ||
    normalized.includes('was not ') ||
    normalized.includes('has not ');

  const negated = explicitNegated || textNegated;
  const core = normalized
    .replace(/^not\s+/, '')
    .replace(/\bnot\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    core.includes('pass') &&
    (core.includes('added') ||
      core.includes('wallet') ||
      core.includes('install'))
  ) {
    return { kind: 'pass_added', negated };
  }

  if (core.includes('redeem')) {
    return { kind: 'reward_redeemed', negated };
  }

  const unitFromConfig = normalizeSignupDelayUnit(condition.unit);
  const amountFromConfig = Number(condition.amount ?? condition.hours);
  const comparatorFromConfig = normalizeComparator(condition.comparator);

  const offerExpiresMatch = core.match(
    /offer expires in less than\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)/,
  );
  if (
    offerExpiresMatch ||
    (core.includes('offer expires') && core.includes('less than'))
  ) {
    const amountFromText = offerExpiresMatch
      ? Number(offerExpiresMatch[1])
      : NaN;
    const unitFromText = offerExpiresMatch
      ? normalizeSignupDelayUnit(offerExpiresMatch[2])
      : null;
    const amount =
      Number.isFinite(amountFromConfig) && amountFromConfig > 0
        ? amountFromConfig
        : amountFromText;
    const unit = unitFromConfig ?? unitFromText ?? 'days';
    if (Number.isFinite(amount) && amount > 0 && unit) {
      return {
        kind: 'offer_expires_within',
        negated,
        amount,
        unit,
      };
    }
  }

  if (isSignupTimeText(core)) {
    const fromPhrase = parseDurationPhrase(core);
    const amount =
      Number.isFinite(amountFromConfig) && amountFromConfig > 0
        ? amountFromConfig
        : fromPhrase?.amount;
    const unit = unitFromConfig ?? fromPhrase?.unit;
    const comparator =
      comparatorFromConfig ?? inferTimeComparator(core);

    if (amount != null && amount > 0 && unit) {
      return {
        kind: 'time_since_signup',
        negated,
        amount,
        unit,
        comparator,
        hours: unit === 'hours' ? amount : undefined,
      };
    }
  }

  if (
    unitFromConfig &&
    Number.isFinite(amountFromConfig) &&
    amountFromConfig > 0 &&
    (isSignupTimeText(core) ||
      condition.amount != null ||
      condition.hours != null)
  ) {
    return {
      kind: 'time_since_signup',
      negated,
      amount: amountFromConfig,
      unit: unitFromConfig,
      comparator: comparatorFromConfig ?? inferTimeComparator(core),
      hours: unitFromConfig === 'hours' ? amountFromConfig : undefined,
    };
  }

  const durationMatch = core.match(
    /(?:over|more than|at least|less than|under)\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)/,
  );
  const sinceMatch = core.match(
    /(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)\s+since\s+sign/,
  );
  const match = durationMatch ?? sinceMatch;
  if (match) {
    const amount = Number(match[1]);
    const unit = normalizeSignupDelayUnit(match[2]);
    if (Number.isFinite(amount) && amount > 0 && unit) {
      return {
        kind: 'time_since_signup',
        negated,
        amount,
        unit,
        comparator: inferTimeComparator(core),
        hours: unit === 'hours' ? amount : undefined,
      };
    }
  }

  if (core.includes('pass not added') || core === 'pass not added') {
    return { kind: 'pass_added', negated: true };
  }

  return { kind: 'unknown', negated };
}

export function msSince(from: Date, to: Date = new Date()): number {
  return to.getTime() - from.getTime();
}

export function hoursSince(from: Date, to: Date = new Date()): number {
  return msSince(from, to) / 3_600_000;
}
