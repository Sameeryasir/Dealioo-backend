import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AUTOMATION_QUEUE, AUTOMATION_JOB_CLEANUP_OPTIONS } from './automation-queue.constants';
import { Automation } from '../../db/entities/automation.entity';
import { AutomationConnection } from '../../db/entities/automation-connection.entity';
import { AutomationExecution } from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import { AutomationNode } from '../../db/entities/automation-node.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { Customer } from '../../db/entities/customer.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { ActivityModule } from '../activity/activity.module';
import { AuthModule } from '../auth/auth.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { AutomationController } from './automation.controller';
import { AutomationEmailRendererService } from './automation-email-renderer.service';
import { AutomationEmailService } from './automation-email.service';
import { AutomationRecipientsService } from './automation-recipients.service';
import { AutomationCronSchedulerService } from './automation-cron-scheduler.service';
import { AutomationFlowService } from './automation-flow.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationQueueProcessor } from './automation-queue.processor';
import { AutomationQueueService } from './automation-queue.service';
import { AutomationService } from './automation.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', '127.0.0.1'),
          port: parseInt(config.get<string>('REDIS_PORT', '6379'), 10),
        },
      }),
    }),
    BullModule.registerQueue({
      name: AUTOMATION_QUEUE,
      defaultJobOptions: AUTOMATION_JOB_CLEANUP_OPTIONS,
    }),
    TypeOrmModule.forFeature([
      Automation,
      AutomationNode,
      AutomationConnection,
      AutomationExecution,
      AutomationLog,
      Restaurant,
      Campaign,
      Funnel,
      FunnelEvent,
      FunnelPayment,
      Customer,
    ]),
    ActivityModule,
    AuthModule,
    RedemptionModule,
  ],
  controllers: [AutomationController],
  providers: [
    AutomationService,
    AutomationEmailService,
    AutomationEmailRendererService,
    AutomationRecipientsService,
    AutomationFlowService,
    AutomationEngineService,
    AutomationExecutionService,
    AutomationLogService,
    AutomationQueueService,
    AutomationQueueProcessor,
    AutomationCronSchedulerService,
  ],
  exports: [AutomationService],
})
export class AutomationModule {}
