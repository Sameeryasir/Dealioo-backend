import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { AutomationNodeType } from '../../db/entities/automation-node.entity';
import { AutomationExecutionStatus } from '../../db/entities/automation-execution.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationWorkerService } from './automation-worker.service';

type NodeRunResult = 'advance' | 'wait' | 'complete' | 'failed';

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  constructor(
    private readonly executionService: AutomationExecutionService,
    private readonly logService: AutomationLogService,
    private readonly workerService: AutomationWorkerService,
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
  ) {}

  async processExecution(executionId: number): Promise<void> {
    const execution = await this.executionService.findById(executionId);

    if (
      execution.status === AutomationExecutionStatus.COMPLETED ||
      execution.status === AutomationExecutionStatus.FAILED
    ) {
      return;
    }

    if (execution.status === AutomationExecutionStatus.WAITING) {
      if (
        execution.scheduledAt &&
        execution.scheduledAt.getTime() > Date.now()
      ) {
        return;
      }
      await this.executionService.updateCurrentNode(
        executionId,
        execution.currentNodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );
    }

    const node = execution.currentNode;
    if (!node) {
      await this.executionService.markFailed(executionId);
      return;
    }

    try {
      const result = await this.runNode(execution, node);
      await this.handleNodeResult(executionId, execution, node.id, result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Node execution failed';
      this.logger.error(`Execution ${executionId} failed: ${message}`, error);
      await this.logService.createLog({
        executionId,
        nodeId: node.id,
        customerId: execution.customerId,
        message: 'Node execution failed',
        error: message,
      });
      await this.executionService.markFailed(executionId);
    }
  }

  async resumeAfterWait(executionId: number): Promise<void> {
    const execution = await this.executionService.findById(executionId);
    if (execution.status !== AutomationExecutionStatus.WAITING) {
      return;
    }

    await this.logService.createLog({
      executionId,
      nodeId: execution.currentNodeId,
      customerId: execution.customerId,
      message: 'Wait completed',
    });

    const nextNodeId = await this.executionService.getNextNodeId(
      execution.automationId,
      execution.currentNodeId,
    );

    if (!nextNodeId) {
      await this.logService.createLog({
        executionId,
        nodeId: execution.currentNodeId,
        customerId: execution.customerId,
        message: 'Workflow completed',
      });
      await this.executionService.markCompleted(executionId);
      return;
    }

    await this.executionService.updateCurrentNode(
      executionId,
      nextNodeId,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    this.workerService.enqueue(() => this.processExecution(executionId));
  }

  private async handleNodeResult(
    executionId: number,
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    nodeId: number,
    result: NodeRunResult,
  ): Promise<void> {
    if (result === 'wait') {
      return;
    }

    if (result === 'complete') {
      await this.logService.createLog({
        executionId,
        nodeId,
        customerId: execution.customerId,
        message: 'Workflow completed',
      });
      await this.executionService.markCompleted(executionId);
      return;
    }

    if (result === 'failed') {
      await this.executionService.markFailed(executionId);
      return;
    }

    const nextNodeId = await this.executionService.getNextNodeId(
      execution.automationId,
      nodeId,
    );

    if (!nextNodeId) {
      await this.logService.createLog({
        executionId,
        nodeId,
        customerId: execution.customerId,
        message: 'Workflow completed',
      });
      await this.executionService.markCompleted(executionId);
      return;
    }

    await this.executionService.updateCurrentNode(
      executionId,
      nextNodeId,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    this.workerService.enqueue(() => this.processExecution(executionId));
  }

  private async runNode(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    node: NonNullable<
      Awaited<ReturnType<AutomationExecutionService['findById']>>['currentNode']
    >,
  ): Promise<NodeRunResult> {
    const config = node.config ?? {};

    switch (node.type) {
      case AutomationNodeType.TRIGGER:
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: 'Workflow started',
        });
        return 'advance';

      case AutomationNodeType.WAIT: {
        const delayMinutes = Number(config.delayMinutes ?? 0);
        if (!Number.isFinite(delayMinutes) || delayMinutes <= 0) {
          await this.logService.createLog({
            executionId: execution.id,
            nodeId: node.id,
            customerId: execution.customerId,
            message: 'Wait skipped (no delay)',
          });
          return 'advance';
        }

        const scheduledAt = new Date(Date.now() + delayMinutes * 60_000);
        await this.executionService.updateCurrentNode(
          execution.id,
          node.id,
          AutomationExecutionStatus.WAITING,
          scheduledAt,
        );
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: `Delay scheduled (${delayMinutes} minutes)`,
        });
        this.workerService.scheduleResume(
          execution.id,
          delayMinutes * 60_000,
          () => this.resumeAfterWait(execution.id),
        );
        return 'wait';
      }

      case AutomationNodeType.EMAIL:
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: `Email sent (template ${config.templateId ?? 'default'})`,
        });
        return 'advance';

      case AutomationNodeType.SMS:
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: 'SMS sent',
        });
        return 'advance';

      case AutomationNodeType.WHATSAPP:
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: 'WhatsApp message sent',
        });
        return 'advance';

      case AutomationNodeType.CONDITION: {
        const passed = await this.evaluateCondition(
          execution,
          String(config.type ?? ''),
        );
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: passed ? 'Condition passed' : 'Condition failed',
        });
        if (passed) {
          return 'complete';
        }
        return 'advance';
      }

      case AutomationNodeType.COUPON:
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: 'Coupon generated',
        });
        return 'advance';

      case AutomationNodeType.TAG:
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: `Tag applied (${String(config.tag ?? 'default')})`,
        });
        return 'advance';

      default:
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: `Unknown node type: ${node.type}`,
          error: 'Unsupported node type',
        });
        return 'failed';
    }
  }

  private async evaluateCondition(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    conditionType: string,
  ): Promise<boolean> {
    if (conditionType === 'payment_exists') {
      const funnelId = execution.automation.funnelId;
      if (!funnelId) {
        return false;
      }

      return this.funnelEventRepository.exist({
        where: {
          funnelId,
          customerId: execution.customerId,
          funnelPaymentId: Not(IsNull()),
        },
      });
    }

    if (conditionType === 'signup_exists') {
      const funnelId = execution.automation.funnelId;
      if (!funnelId) {
        return false;
      }

      return this.funnelEventRepository.exist({
        where: {
          funnelId,
          customerId: execution.customerId,
          eventType: FunnelEventType.SIGNUP,
        },
      });
    }

    return false;
  }
}
