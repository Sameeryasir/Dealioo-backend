import { BadRequestException } from '@nestjs/common';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import { isCronTriggerAutomationNode } from './automation-cron.config';
import { resolveWaitDelayMinutes } from './automation-wait.util';

function resolveCronIntervalMinutes(
  config: Record<string, unknown>,
): number | null {
  const frequency = String(config.frequency ?? '').trim().toLowerCase();
  if (frequency && frequency !== 'interval') {
    return null;
  }

  const interval = Number(config.interval ?? config.intervalMinutes);
  if (!Number.isFinite(interval) || interval <= 0) {
    return null;
  }

  const unit = String(config.unit ?? config.intervalUnit ?? 'minutes')
    .trim()
    .toLowerCase();
  if (unit.startsWith('hour')) {
    return Math.floor(interval * 60);
  }
  if (unit.startsWith('day')) {
    return Math.floor(interval * 60 * 24);
  }
  return Math.floor(interval);
}

function formatMinutesLabel(minutes: number): string {
  if (minutes >= 60 * 24 && minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24);
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

function isWaitNode(node: AutomationNode): boolean {
  return node.type === AutomationNodeType.WAIT;
}

function findPaymentReminderWaitMinutes(nodes: AutomationNode[]): number {
  const ordered = [...nodes].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.id - right.id;
  });

  const emailIndices = ordered
    .map((node, index) => (node.type === AutomationNodeType.EMAIL ? index : -1))
    .filter((index) => index >= 0);

  if (emailIndices.length >= 2) {
    const firstEmailIndex = emailIndices[0];
    const secondEmailIndex = emailIndices[1];
    let betweenEmailsWait = 0;

    for (let index = firstEmailIndex + 1; index < secondEmailIndex; index++) {
      const node = ordered[index];
      if (isWaitNode(node)) {
        betweenEmailsWait = Math.max(
          betweenEmailsWait,
          resolveWaitDelayMinutes(node.config ?? {}),
        );
      }
    }

    if (betweenEmailsWait > 0) {
      return betweenEmailsWait;
    }
  }

  let maxWait = 0;
  for (const node of ordered) {
    if (isWaitNode(node)) {
      maxWait = Math.max(
        maxWait,
        resolveWaitDelayMinutes(node.config ?? {}),
      );
    }
  }
  return maxWait;
}

export function assertPaymentReminderScheduleValid(
  purpose: AutomationPurpose,
  nodes: AutomationNode[],
): void {
  if (purpose !== AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER) {
    return;
  }

  const cronNode = nodes.find(isCronTriggerAutomationNode);
  if (!cronNode) {
    return;
  }

  const cronIntervalMinutes = resolveCronIntervalMinutes(
    cronNode.config ?? {},
  );
  if (cronIntervalMinutes === null) {
    return;
  }

  const waitDelayMinutes = findPaymentReminderWaitMinutes(nodes);
  if (waitDelayMinutes <= 0) {
    return;
  }

  if (cronIntervalMinutes < waitDelayMinutes) {
    throw new BadRequestException(
      `The cron schedule (every ${formatMinutesLabel(cronIntervalMinutes)}) cannot be shorter than the Wait step (${formatMinutesLabel(waitDelayMinutes)}). Increase the cron interval or reduce the wait time so guests do not get duplicate reminders before the QR pass email is sent.`,
    );
  }
}
