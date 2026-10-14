export const AUTOMATION_QUEUE = 'automation';
export const AUTOMATION_JOURNEY_QUEUE = AUTOMATION_QUEUE;
export const AUTOMATION_SEND_QUEUE = 'automation-send';

export const DEFAULT_AUTOMATION_QUEUE_CONCURRENCY = 100;
export const DEFAULT_AUTOMATION_SEND_QUEUE_CONCURRENCY = 40;
export const DEFAULT_AUTOMATION_GRAPH_BATCH_START_CAP = 200;
export const DEFAULT_AUTOMATION_GRAPH_BATCH_STAGGER_MS = 100;
export const DEFAULT_AUTOMATION_CRON_STAGGER_WINDOW_MS = 60_000;
export const DEFAULT_AUTOMATION_CRON_TICK_CONCURRENCY = 5;
export const DEFAULT_AUTOMATION_CHUNK_ENQUEUE_STAGGER_MS = 25;
export const AUTOMATION_ACTIVE_CACHE_TTL_MS = 15_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

export function resolveAutomationQueueConcurrency(): number {
  return Math.min(
    parsePositiveInt(
      process.env.AUTOMATION_JOURNEY_QUEUE_CONCURRENCY ??
        process.env.AUTOMATION_QUEUE_CONCURRENCY,
      DEFAULT_AUTOMATION_QUEUE_CONCURRENCY,
    ),
    500,
  );
}

export function resolveAutomationSendQueueConcurrency(): number {
  return Math.min(
    parsePositiveInt(
      process.env.AUTOMATION_SEND_QUEUE_CONCURRENCY,
      DEFAULT_AUTOMATION_SEND_QUEUE_CONCURRENCY,
    ),
    500,
  );
}

export function resolveAutomationGraphBatchStartCap(): number {
  const raw = process.env.AUTOMATION_GRAPH_BATCH_START_CAP?.trim();
  if (raw === '0') {
    return 0;
  }
  return parsePositiveInt(raw, DEFAULT_AUTOMATION_GRAPH_BATCH_START_CAP);
}

export function resolveAutomationGraphBatchStaggerMs(): number {
  const raw = process.env.AUTOMATION_GRAPH_BATCH_STAGGER_MS?.trim();
  if (raw === '0') {
    return 0;
  }
  const parsed = parseInt(
    raw ?? String(DEFAULT_AUTOMATION_GRAPH_BATCH_STAGGER_MS),
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_AUTOMATION_GRAPH_BATCH_STAGGER_MS;
  }
  return Math.min(parsed, 10_000);
}

export function resolveAutomationUnifiedGraphExecution(): boolean {
  const raw = process.env.AUTOMATION_UNIFIED_GRAPH_EXECUTION?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return true;
}

export function resolveAutomationCronStaggerWindowMs(): number {
  const raw = process.env.AUTOMATION_CRON_STAGGER_WINDOW_MS?.trim();
  if (raw === '0') {
    return 0;
  }
  const parsed = parseInt(
    raw ?? String(DEFAULT_AUTOMATION_CRON_STAGGER_WINDOW_MS),
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_AUTOMATION_CRON_STAGGER_WINDOW_MS;
  }
  return Math.min(parsed, 5 * 60_000);
}

export function resolveAutomationCronTickConcurrency(): number {
  return Math.min(
    parsePositiveInt(
      process.env.AUTOMATION_CRON_TICK_CONCURRENCY,
      DEFAULT_AUTOMATION_CRON_TICK_CONCURRENCY,
    ),
    50,
  );
}

export function resolveAutomationChunkEnqueueStaggerMs(): number {
  const raw = process.env.AUTOMATION_CHUNK_ENQUEUE_STAGGER_MS?.trim();
  if (raw === '0') {
    return 0;
  }
  const parsed = parseInt(
    raw ?? String(DEFAULT_AUTOMATION_CHUNK_ENQUEUE_STAGGER_MS),
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_AUTOMATION_CHUNK_ENQUEUE_STAGGER_MS;
  }
  return Math.min(parsed, 2_000);
}

export function resolveAutomationCronStartOffsetMs(automationId: number): number {
  const windowMs = resolveAutomationCronStaggerWindowMs();
  if (windowMs <= 0 || automationId <= 0) {
    return 0;
  }
  return (automationId * 7919) % windowMs;
}

export enum AutomationJobName {
  UNPAID_REMINDER_BATCH = 'unpaid-reminder-batch',
  PROCESS_EXECUTION = 'process-execution',
  RESUME_EXECUTION = 'resume-execution',
  CRON_TICK = 'cron-tick',
  HANDLE_FUNNEL_EVENT = 'handle-funnel-event',
  CONTINUE_GRAPH_BATCH = 'continue-graph-batch',
  PURGE_AUTOMATION_JOBS = 'purge-automation-jobs',
}

export function resolveAutomationQueueLimiter():
  | { max: number; duration: number }
  | undefined {
  const maxRaw = process.env.AUTOMATION_QUEUE_RATE_MAX?.trim();
  const durationRaw = process.env.AUTOMATION_QUEUE_RATE_DURATION_MS?.trim();
  const max = maxRaw ? parseInt(maxRaw, 10) : 250;
  const duration = durationRaw ? parseInt(durationRaw, 10) : 1000;
  if (!Number.isFinite(max) || max < 1) {
    return { max: 250, duration: 1000 };
  }
  if (!Number.isFinite(duration) || duration < 100) {
    return { max, duration: 1000 };
  }
  return { max, duration };
}

export function resolveAutomationSendQueueLimiter():
  | { max: number; duration: number }
  | undefined {
  const maxRaw = process.env.AUTOMATION_SEND_QUEUE_RATE_MAX?.trim();
  const durationRaw = process.env.AUTOMATION_SEND_QUEUE_RATE_DURATION_MS?.trim();
  if (!maxRaw && !durationRaw) {
    return { max: 100, duration: 1000 };
  }
  const max = maxRaw ? parseInt(maxRaw, 10) : 100;
  const duration = durationRaw ? parseInt(durationRaw, 10) : 1000;
  if (!Number.isFinite(max) || max < 1) {
    return { max: 100, duration: 1000 };
  }
  if (!Number.isFinite(duration) || duration < 100) {
    return { max, duration: 1000 };
  }
  return { max, duration };
}

export function automationCronSchedulerKey(automationId: number): string {
  return `automation-cron:${automationId}`;
}

export const AUTOMATION_JOB_CLEANUP_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: true,
} as const;
