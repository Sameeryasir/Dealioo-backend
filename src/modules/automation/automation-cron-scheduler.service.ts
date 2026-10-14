import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TtlCache } from '../../common/ttl-cache';
import { Automation } from '../../db/entities/automation.entity';
import { AutomationNode } from '../../db/entities/automation-node.entity';
import {
  cronIntervalMs,
  type ParsedCronTriggerConfig,
  resolveCronFromAutomationNodes,
  sortAutomationNodes,
} from './automation-cron.config';
import { AUTOMATION_ACTIVE_CACHE_TTL_MS } from './automation-queue.constants';

import { AutomationQueueService } from './automation-queue.service';

export type VerifiedCronSchedule = {
  config: ParsedCronTriggerConfig;
  interval: unknown;
  unit: string;
};

type AutomationActiveSnapshot = {
  published: boolean;
  isActive: boolean;
};

@Injectable()
export class AutomationCronSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AutomationCronSchedulerService.name);
  private readonly activeCache = new TtlCache();

  constructor(
    @InjectRepository(Automation)
    private readonly automationRepository: Repository<Automation>,
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
    private readonly queueService: AutomationQueueService,
  ) {}

  async getAutomationActiveSnapshot(
    automationId: number,
  ): Promise<AutomationActiveSnapshot | null> {
    const cacheKey = `automation-active:${automationId}`;
    return this.activeCache.getOrSet(
      cacheKey,
      AUTOMATION_ACTIVE_CACHE_TTL_MS,
      async () => {
        const automation = await this.automationRepository.findOne({
          where: { id: automationId },
          select: ['id', 'published', 'isActive'],
        });
        if (!automation) {
          return null;
        }
        return {
          published: automation.published === true,
          isActive: automation.isActive === true,
        };
      },
    );
  }

  invalidateAutomationActiveCache(automationId: number): void {
    this.activeCache.delete(`automation-active:${automationId}`);
  }

  async onModuleInit(): Promise<void> {
    await this.syncAllCronSchedules();
  }

  async syncAllCronSchedules(): Promise<void> {
    const automations = await this.automationRepository.find({
      select: ['id'],
    });

    for (const automation of automations) {
      await this.syncAutomationCron(automation.id);
    }
  }

  async syncAutomationCron(
    automationId: number,
    options?: { silent?: boolean; restartFromNow?: boolean },
  ): Promise<(VerifiedCronSchedule & { nextCronAt: Date | null }) | null> {
    const verified = await this.resolvePublishedCronSchedule(automationId);

    if (!verified) {
      await this.queueService.removeCronSchedule(automationId);
      return null;
    }

    const intervalMs = cronIntervalMs(verified.config);
    const nextCronAt = await this.queueService.upsertCronSchedule(
      automationId,
      intervalMs,
      {
        restartFromNow: options?.restartFromNow === true,
      },
    );

    if (!options?.silent) {
      this.logger.log(
        `Cron schedule synced for automation ${automationId} (every ${verified.interval} ${verified.unit}, ${intervalMs}ms${nextCronAt ? `, next tick ${nextCronAt.toISOString()}` : ''})`,
      );
    }

    return { ...verified, nextCronAt };
  }

  async resolvePublishedCronSchedule(
    automationId: number,
  ): Promise<VerifiedCronSchedule | null> {
    const automation = await this.getAutomationActiveSnapshot(automationId);

    if (!automation?.published || !automation.isActive) {
      return null;
    }

    const nodes = await this.nodeRepository.find({
      where: { automationId },
      order: { order: 'ASC', id: 'ASC' },
    });

    const cronConfig = resolveCronFromAutomationNodes(nodes);
    if (!cronConfig) {
      return null;
    }

    const triggerConfig = sortAutomationNodes(nodes)[0]?.config ?? {};
    const interval = triggerConfig.interval;
    const unit = String(
      triggerConfig.unit ?? triggerConfig.intervalUnit ?? 'minutes',
    );

    return {
      config: cronConfig,
      interval,
      unit,
    };
  }

  async verifyAndRefreshBeforeRun(
    automationId: number,
  ): Promise<VerifiedCronSchedule | null> {
    const verified = await this.resolvePublishedCronSchedule(automationId);
    if (!verified) {
      this.logger.log(
        `Cron run blocked for automation ${automationId}: not published, missing cron trigger, or invalid interval/unit in DB`,
      );
      return null;
    }

    this.logger.log(
      `Cron verified from DB for automation ${automationId} (every ${verified.interval} ${verified.unit}, ${verified.config.intervalMs}ms)`,
    );
    return verified;
  }
}
