import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Automation } from '../../db/entities/automation.entity';
import { AutomationConnection } from '../../db/entities/automation-connection.entity';
import { AutomationExecution } from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import { AutomationNode } from '../../db/entities/automation-node.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import { FunnelEvent } from '../../db/entities/funnel-event.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';
import { AutomationController } from './automation.controller';
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
    ]),
    AuthModule,
  ],
  controllers: [AutomationController],
  providers: [
    AutomationService,
    AutomationEngineService,
    AutomationExecutionService,
    AutomationLogService,
    AutomationWorkerService,
  ],
  exports: [AutomationService],
})
export class AutomationModule {}
