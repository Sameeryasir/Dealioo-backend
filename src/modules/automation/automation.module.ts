import { BullModule } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AUTOMATION_QUEUE, AUTOMATION_JOB_CLEANUP_OPTIONS } from './automation-queue.constants';
import { Automation } from '../../db/entities/automation.entity';
import { AutomationConnection } from '../../db/entities/automation-connection.entity';
import { AutomationDeadLetter } from '../../db/entities/automation-dead-letter.entity';
import { AutomationExecution } from '../../db/entities/automation-execution.entity';
import { AutomationExecutionEvent } from '../../db/entities/automation-execution-event.entity';
import { AutomationExecutionRecipient } from '../../db/entities/automation-execution-recipient.entity';
import { AutomationExecutionStep } from '../../db/entities/automation-execution-step.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import { AutomationNode } from '../../db/entities/automation-node.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { Customer } from '../../db/entities/customer.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { FunnelPayment } from '../../db/entities/funnel-payment.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import { ActivityModule } from '../activity/activity.module';
import { BusinessHistoryModule } from '../business-history/business-history.module';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { RedemptionModule } from '../redemption/redemption.module';
import { PaymentModule } from '../payment/payment.module';
import { AutomationConditionRegistry } from './automation-condition.registry';
import { CustomerVisitedConditionEvaluator } from './conditions/customer-visited.condition';
import { AutomationController } from './automation.controller';
import { AutomationDeadLetterService } from './automation-dead-letter.service';
import { AutomationEmailRendererService } from './automation-email-renderer.service';
import { AutomationEmailService } from './automation-email.service';
import { AutomationExecutionEventService } from './automation-execution-event.service';
import { AutomationExecutionObservabilityService } from './automation-execution-observability.service';
import { AutomationExecutionRecoveryService } from './automation-execution-recovery.service';
import { AutomationMetricsService } from './automation-metrics.service';
import { AutomationRecipientsService } from './automation-recipients.service';
import { AutomationCronSchedulerService } from './automation-cron-scheduler.service';
import { AutomationFlowService } from './automation-flow.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationQueueProcessor } from './automation-queue.processor';
import { AutomationQueueService } from './automation-queue.service';
import { AutomationWaitSchedulerService } from './automation-wait-scheduler.service';
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
      AutomationExecutionEvent,
      AutomationExecutionStep,
      AutomationExecutionRecipient,
      AutomationDeadLetter,
      AutomationLog,
      Business,
      Campaign,
      Funnel,
      FunnelEvent,
      FunnelPayment,
      Customer,
      CustomerVisit,
    ]),
    ActivityModule,
    BusinessHistoryModule,
    ChatModule,
    AuthModule,
    forwardRef(() => RedemptionModule),
    forwardRef(() => PaymentModule),
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
    AutomationExecutionEventService,
    AutomationExecutionObservabilityService,
    AutomationExecutionRecoveryService,
    AutomationDeadLetterService,
    AutomationMetricsService,
    AutomationConditionRegistry,
    CustomerVisitedConditionEvaluator,
    AutomationLogService,
    AutomationQueueService,
    AutomationQueueProcessor,
    AutomationCronSchedulerService,
    AutomationWaitSchedulerService,
  ],
  exports: [AutomationService, AutomationQueueService],
})
export class AutomationModule {}
