import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { AuthModule } from '../auth/auth.module';
import { AutomationController } from './automation.controller';
import { AutomationEmailRendererService } from './automation-email-renderer.service';
import { AutomationMailService } from './automation-mail.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationWorkerService } from './automation-worker.service';
import { AutomationService } from './automation.service';

@Module({
  imports: [
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
    AuthModule,
  ],
  controllers: [AutomationController],
  providers: [
    AutomationService,
    AutomationMailService,
    AutomationEmailRendererService,
    AutomationEngineService,
    AutomationExecutionService,
    AutomationLogService,
    AutomationWorkerService,
  ],
  exports: [AutomationService],
})
export class AutomationModule {}
