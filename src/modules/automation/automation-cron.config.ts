import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';

export type ParsedCronTriggerConfig = {
  intervalMs: number;
  intervalMinutes: number;
};

const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 10_080 * 60_000;

type IntervalUnit = 'ms' | 'seconds' | 'minutes' | 'hours';

export function parseCronTriggerConfig(
  config: Record<string, unknown>,
): ParsedCronTriggerConfig | null {
  const trigger = String(config.trigger ?? config.triggerType ?? '')
    .trim()
    .toLowerCase();

  if (trigger !== 'cron') {
    return null;
  }

  const intervalMs = resolveIntervalMsFromConfig(config);
  if (intervalMs === null) {
    return null;
  }

  return buildCronConfig(intervalMs);
}

function resolveIntervalMsFromConfig(
  config: Record<string, unknown>,
): number | null {
  const frequency = String(config.frequency ?? '').trim().toLowerCase();
  if (frequency && frequency !== 'interval') {
    return null;
  }

  const primary = resolveIntervalWithUnit(
    config.interval,
    readUnit(config.unit ?? config.intervalUnit),
  );
  if (primary !== null) {
    return primary;
  }

  const schedule =
    config.schedule && typeof config.schedule === 'object'
      ? (config.schedule as Record<string, unknown>)
      : null;

  if (schedule) {
    const fromSchedule = resolveIntervalWithUnit(
      schedule.interval,
      readUnit(schedule.unit ?? schedule.intervalUnit ?? config.unit),
    );
    if (fromSchedule !== null) {
      return fromSchedule;
    }
  }

  const fromMs = readMsField(config);
  if (fromMs !== null) {
    return fromMs;
  }

  const fromSeconds = readNumericField(config, [
    'intervalSeconds',
    'interval_seconds',
    'seconds',
  ]);
  if (fromSeconds !== null) {
    return toIntervalMs(fromSeconds, 'seconds');
  }

  const rawInterval = readFirstDefined(config, [
    'intervalMinutes',
    'interval_minutes',
    'timeInterval',
    'time_interval',
    'minutes',
    'everyMinutes',
    'every',
    'value',
    'amount',
  ]);

  if (rawInterval !== undefined) {
    return parseIntervalValue(
      rawInterval,
      readUnit(config.unit ?? config.intervalUnit) ?? 'minutes',
    );
  }

  return null;
}

function resolveIntervalWithUnit(
  interval: unknown,
  unit: IntervalUnit | undefined,
): number | null {
  if (interval === undefined || interval === null) {
    return null;
  }

  if (!unit) {
    return parseIntervalValue(interval, 'minutes');
  }

  return parseIntervalValue(interval, unit);
}

function readMsField(source: Record<string, unknown>): number | null {
  const raw = readFirstDefined(source, [
    'intervalMs',
    'interval_ms',
    'everyMs',
    'every_ms',
  ]);
  if (raw === undefined) {
    return null;
  }
  const ms = Math.floor(Number(raw));
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  return clampIntervalMs(ms);
}

function readNumericField(
  source: Record<string, unknown>,
  keys: string[],
): number | null {
  const raw = readFirstDefined(source, keys);
  if (raw === undefined) {
    return null;
  }
  const value = Math.floor(Number(raw));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readFirstDefined(
  source: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

function readUnit(raw: unknown): IntervalUnit | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const unit = String(raw).trim().toLowerCase();
  if (unit === 'ms' || unit === 'millisecond' || unit === 'milliseconds') {
    return 'ms';
  }
  if (
    unit === 's' ||
    unit === 'sec' ||
    unit === 'secs' ||
    unit === 'second' ||
    unit === 'seconds'
  ) {
    return 'seconds';
  }
  if (
    unit === 'm' ||
    unit === 'min' ||
    unit === 'mins' ||
    unit === 'minute' ||
    unit === 'minutes'
  ) {
    return 'minutes';
  }
  if (
    unit === 'h' ||
    unit === 'hr' ||
    unit === 'hrs' ||
    unit === 'hour' ||
    unit === 'hours'
  ) {
    return 'hours';
  }
  return undefined;
}

function parseIntervalValue(
  raw: unknown,
  explicitUnit?: IntervalUnit,
): number | null {
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    return parseIntervalValue(
      record.value ?? record.amount ?? record.interval,
      readUnit(record.unit ?? record.intervalUnit) ?? explicitUnit,
    );
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase();
    const match = trimmed.match(
      /^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/,
    );
    if (match) {
      const amount = Number(match[1]);
      const unit = readUnit(match[2]) ?? explicitUnit ?? 'minutes';
      return toIntervalMs(amount, unit);
    }

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return toIntervalMs(asNumber, explicitUnit ?? 'minutes');
    }
    return null;
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  if (!explicitUnit) {
    return toIntervalMs(amount, 'minutes');
  }

  return toIntervalMs(amount, explicitUnit);
}

function toIntervalMs(amount: number, unit: IntervalUnit): number {
  switch (unit) {
    case 'ms':
      return clampIntervalMs(Math.floor(amount));
    case 'seconds':
      return clampIntervalMs(Math.floor(amount * 1000));
    case 'hours':
      return clampIntervalMs(Math.floor(amount * 60 * 60_000));
    case 'minutes':
    default:
      return clampIntervalMs(Math.floor(amount * 60_000));
  }
}

function clampIntervalMs(ms: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms));
}

function buildCronConfig(intervalMs: number): ParsedCronTriggerConfig {
  const clamped = clampIntervalMs(intervalMs);
  return {
    intervalMs: clamped,
    intervalMinutes: Math.max(1, Math.round(clamped / 60_000)),
  };
}

export function sortAutomationNodes(nodes: AutomationNode[]): AutomationNode[] {
  return [...nodes].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.id - right.id;
  });
}

export function isCronTriggerAutomationNode(node: AutomationNode): boolean {
  return isCronTriggerNodePayload(node.type, node.config ?? {});
}

export function isCronTriggerNodePayload(
  type: AutomationNodeType,
  config: Record<string, unknown>,
): boolean {
  if (type !== AutomationNodeType.TRIGGER) {
    return false;
  }

  const trigger = String(config.trigger ?? config.triggerType ?? '')
    .trim()
    .toLowerCase();

  return trigger === 'cron';
}

export function clampAutomationNodeOrder(
  node: AutomationNode,
  requestedOrder: number,
  allNodes: AutomationNode[],
): number {
  const cronNode = allNodes.find(isCronTriggerAutomationNode);
  const safeOrder = Math.max(0, requestedOrder);

  if (isCronTriggerAutomationNode(node)) {
    return 0;
  }

  if (cronNode && cronNode.id !== node.id && safeOrder <= cronNode.order) {
    return Math.max(1, cronNode.order + 1);
  }

  return safeOrder;
}

export function resolveCronFromAutomationNodes(
  nodes: AutomationNode[],
): ParsedCronTriggerConfig | null {
  const ordered = sortAutomationNodes(nodes);
  const firstNode = ordered[0];

  if (!firstNode || firstNode.type !== AutomationNodeType.TRIGGER) {
    return null;
  }

  return parseCronTriggerConfig(firstNode.config ?? {});
}

export function cronIntervalMs(config: ParsedCronTriggerConfig): number {
  return config.intervalMs;
}
