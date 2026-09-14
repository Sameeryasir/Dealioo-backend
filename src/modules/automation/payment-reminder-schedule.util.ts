import { BadRequestException } from '@nestjs/common';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import { resolveWaitDelayMinutes } from './automation-wait.util';
import {
  isCronTriggerAutomationNode,
  sortAutomationNodes,
} from './automation-cron.config';

const MINUTES_PER_DAY = 60 * 24;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;

function formatMinutesLabel(minutes: number): string {
  if (minutes >= MINUTES_PER_DAY && minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * How often this cron is meant to start a new run (for schedule validation).
 * Daily ≈ 1 day, weekly ≈ 7 days, interval uses the configured amount.
 */
export function resolveCronPeriodMinutesFromConfig(
  config: Record<string, unknown>,
): number | null {
  const trigger = String(config.trigger ?? config.triggerType ?? '')
    .trim()
    .toLowerCase();
  if (trigger !== 'cron') {
    return null;
  }

  const frequency = String(config.frequency ?? '')
    .trim()
    .toLowerCase();

  if (frequency === 'daily' || frequency === '') {
    // "Every day at 9 AM" → one run per day
    return MINUTES_PER_DAY;
  }
  if (frequency === 'weekly') {
    return MINUTES_PER_WEEK;
  }

  // frequency === 'interval' (or legacy interval-only configs)
  const unit = String(config.unit ?? config.intervalUnit ?? 'minutes')
    .trim()
    .toLowerCase();
  const raw =
    config.interval ??
    config.intervalMinutes ??
    config.value ??
    config.amount;
  const amount = Math.floor(Number(raw));
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  if (unit.startsWith('day')) {
    return amount * MINUTES_PER_DAY;
  }
  if (unit.startsWith('hour')) {
    return amount * 60;
  }
  if (
    unit === 'ms' ||
    unit.startsWith('millisecond') ||
    unit === 's' ||
    unit.startsWith('sec')
  ) {
    // Convert sub-minute units up to whole minutes (ceil so tiny waits still compare safely)
    const ms =
      unit === 'ms' || unit.startsWith('millisecond')
        ? amount
        : amount * 1000;
    return Math.max(1, Math.ceil(ms / 60_000));
  }

  return amount;
}

export function findMaxFixedWaitDelayMinutes(
  nodes: AutomationNode[],
): number {
  let maxWait = 0;
  for (const node of nodes) {
    if (node.type !== AutomationNodeType.WAIT) {
      continue;
    }
    maxWait = Math.max(
      maxWait,
      resolveWaitDelayMinutes(node.config ?? {}),
    );
  }
  return maxWait;
}

/**
 * Cron must outlast every fixed wait so a scheduled run can finish
 * before the next cron tick is meant to start.
 */
export function assertPaymentReminderScheduleValid(
  _purpose: AutomationPurpose,
  nodes: AutomationNode[],
): void {
  const ordered = sortAutomationNodes(nodes);
  const cronNode = ordered.find(isCronTriggerAutomationNode);
  if (!cronNode) {
    return;
  }

  const cronMinutes = resolveCronPeriodMinutesFromConfig(
    cronNode.config ?? {},
  );
  if (cronMinutes == null || cronMinutes <= 0) {
    return;
  }

  const waitMinutes = findMaxFixedWaitDelayMinutes(ordered);
  if (waitMinutes <= 0) {
    return;
  }

  if (waitMinutes >= cronMinutes) {
    throw new BadRequestException(
      `Your cron is set to run every ${formatMinutesLabel(cronMinutes)}, but a wait node pauses for ${formatMinutesLabel(waitMinutes)}. Make the cron interval longer than every wait so each scheduled run can finish before the next one starts.`,
    );
  }
}
