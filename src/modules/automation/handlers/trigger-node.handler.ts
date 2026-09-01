import { Injectable } from '@nestjs/common';
import {
  AutomationNodeType,
  type AutomationNode,
} from '../../../db/entities/automation-node.entity';
import { AutomationExecutionEventType } from '../../../db/entities/automation-execution-event.entity';
import type { AutomationExecution } from '../../../db/entities/automation-execution.entity';
import { AutomationExecutionRecorderService } from '../automation-execution-recorder.service';
import { AutomationLogService } from '../automation-log.service';
import type {
  AutomationNodeHandler,
  AutomationNodeHandlerContext,
} from '../engine/automation-node-handler.types';
import { nodeResult } from '../engine/automation-node-result.types';

@Injectable()
export class TriggerNodeHandler implements AutomationNodeHandler {
  readonly type = AutomationNodeType.TRIGGER;

  constructor(
    private readonly logService: AutomationLogService,
    private readonly recorder: AutomationExecutionRecorderService,
  ) {}

  async execute(context: AutomationNodeHandlerContext) {
    const { execution, node } = context;
    const config = node.config ?? {};
    const triggerLabel = this.resolveTriggerLabel(config, node, execution);

    await this.recorder.recordEvent(
      execution,
      AutomationExecutionEventType.EXECUTION_STARTED,
      node.id,
      { automationVersion: execution.automationVersion },
    );

    await this.logService.createLog({
      executionId: execution.id,
      nodeId: node.id,
      customerId: execution.customerId,
      message: `Trigger fired (${triggerLabel}) — starting workflow`,
    });

    return nodeResult('advance');
  }

  private resolveTriggerLabel(
    config: Record<string, unknown>,
    node: AutomationNode,
    execution: AutomationExecution,
  ): string {
    return String(
      config.trigger ??
        config.triggerType ??
        config.event ??
        execution.automation?.trigger ??
        'trigger',
    );
  }

}
