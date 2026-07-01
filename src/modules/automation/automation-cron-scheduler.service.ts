import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Automation } from '../../db/entities/automation.entity';
import { AutomationNode } from '../../db/entities/automation-node.entity';
import {
  cronIntervalMs,
  type ParsedCronTriggerConfig,
  resolveCronFromAutomationNodes,
  sortAutomationNodes,
} from './automation-cron.config';

import { AutomationQueueService } from './automation-queue.service';

export type VerifiedCronSchedule = {
  config: ParsedCronTriggerConfig;
  interval: unknown;
  unit: string;
};

@Injectable()
export class AutomationCronSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AutomationCronSchedulerService.name);

  constructor(
    @InjectRepository(Automation)
    private readonly automationRepository: Repository<Automation>,
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
    private readonly queueService: AutomationQueueService,
  ) {}

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
    options?: { silent?: boolean },
  ): Promise<VerifiedCronSchedule | null> {
    const verified = await this.resolvePublishedCronSchedule(automationId);

    if (!verified) {
      await this.queueService.removeCronSchedule(automationId);
      return null;
    }

    const intervalMs = cronIntervalMs(verified.config);
    await this.queueService.upsertCronSchedule(automationId, intervalMs);

    if (!options?.silent) {
      this.logger.log(
        `Cron schedule synced for automation ${automationId} (every ${verified.interval} ${verified.unit}, ${intervalMs}ms)`,
      );
    }

    return verified;
  }

  /** Read cron config from DB only — does not touch the BullMQ scheduler. */
  async resolvePublishedCronSchedule(
    automationId: number,
  ): Promise<VerifiedCronSchedule | null> {
    const automation = await this.automationRepository.findOne({
      where: { id: automationId },
      select: ['id', 'published'],
    });

    if (!automation?.published) {
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
