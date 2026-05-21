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
    const automation = await this.automationRepository.findOne({
      where: { id: automationId },
      select: ['id', 'isActive'],
    });

    if (!automation) {
      await this.queueService.removeCronSchedule(automationId);
      return null;
    }

    const nodes = await this.nodeRepository.find({
      where: { automationId },
      order: { order: 'ASC', id: 'ASC' },
    });

    const cronConfig = automation.isActive
      ? resolveCronFromAutomationNodes(nodes)
      : null;

    if (!cronConfig) {
      await this.queueService.removeCronSchedule(automationId);
      return null;
    }

    const intervalMs = cronIntervalMs(cronConfig);
    await this.queueService.upsertCronSchedule(automationId, intervalMs);

    const triggerConfig = sortAutomationNodes(nodes)[0]?.config ?? {};
    const interval = triggerConfig.interval;
    const unit = String(
      triggerConfig.unit ?? triggerConfig.intervalUnit ?? 'minutes',
    );

    if (!options?.silent) {
      this.logger.log(
        `Cron schedule synced for automation ${automationId} (every ${interval} ${unit}, ${intervalMs}ms)`,
      );
    }

    return {
      config: cronConfig,
      interval,
      unit,
    };
  }

  async verifyAndRefreshBeforeRun(
    automationId: number,
  ): Promise<VerifiedCronSchedule | null> {
    const verified = await this.syncAutomationCron(automationId, { silent: true });
    if (!verified) {
      this.logger.log(
        `Cron run blocked for automation ${automationId}: inactive, missing cron trigger, or invalid interval/unit in DB`,
      );
      return null;
    }

    this.logger.log(
      `Cron verified from DB for automation ${automationId} (every ${verified.interval} ${verified.unit}, ${verified.config.intervalMs}ms)`,
    );
    return verified;
  }
}
