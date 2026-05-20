import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { AutomationNodeType } from '../../db/entities/automation-node.entity';
import { AutomationExecutionStatus } from '../../db/entities/automation-execution.entity';
import { Customer } from '../../db/entities/customer.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationLogService } from './automation-log.service';
import { resolveAutomationEmailTemplateFromPurpose } from '../../templates/automation/registry';
import { AutomationEmailRendererService } from './automation-email-renderer.service';
import { AutomationMailService } from './automation-mail.service';
import { AutomationWorkerService } from './automation-worker.service';

type NodeRunResult = 'advance' | 'wait' | 'complete' | 'failed';

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  constructor(
    private readonly executionService: AutomationExecutionService,
    private readonly logService: AutomationLogService,
    private readonly mailService: AutomationMailService,
    private readonly emailRenderer: AutomationEmailRendererService,
    private readonly workerService: AutomationWorkerService,
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
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

      case AutomationNodeType.EMAIL: {
        const subject = String(config.subject ?? '').trim();
        const templateKey = resolveAutomationEmailTemplateFromPurpose(
          execution.automation.purpose,
        );
        const to = execution.customer?.email?.trim();
        const customerName =
          execution.customer?.name?.trim() || to?.split('@')[0] || 'there';

        if (to && subject) {
          const { html, text } = await this.emailRenderer.render(templateKey, {
            customerName,
            customerEmail: to,
            subject,
            message: config.message ? String(config.message) : undefined,
            headline: config.headline ? String(config.headline) : undefined,
            ctaLabel: config.ctaLabel ? String(config.ctaLabel) : undefined,
            ctaUrl: config.ctaUrl ? String(config.ctaUrl) : undefined,
          });
          await this.mailService.send({ to, subject, html, text });
        }

        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message:
            to && subject
              ? `Email sent to ${to}`
              : 'Email skipped (missing recipient or subject)',
        });
        return 'advance';
      }

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
        const conditionType = String(config.type ?? '');
        const stopFlow = await this.shouldStopAfterCondition(
          execution,
          conditionType,
        );
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: stopFlow
            ? 'Condition met — workflow stops'
            : 'Condition not met — continue to next step',
        });
        if (stopFlow) {
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

  private async shouldStopAfterCondition(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    conditionType: string,
  ): Promise<boolean> {
    const funnelId = execution.automation.funnelId;
    if (!funnelId) {
      return false;
    }

    if (conditionType === 'payment_not_paid') {
      return this.customerHasPaidOnFunnel(funnelId, execution.customerId);
    }

    if (conditionType === 'payment_pending') {
      const paid = await this.customerHasPaidOnFunnel(
        funnelId,
        execution.customerId,
      );
      if (paid) {
        return true;
      }
      const hasUnpaidAttempt = await this.customerHasUnpaidPaymentOnFunnel(
        funnelId,
        execution.customerId,
      );
      return !hasUnpaidAttempt;
    }

    if (conditionType === 'payment_exists') {
      return this.customerHasPaidOnFunnel(funnelId, execution.customerId);
    }

    if (conditionType === 'signup_exists') {
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

  private async customerHasPaidOnFunnel(
    funnelId: number,
    customerId: number,
  ): Promise<boolean> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      return false;
    }

    return this.funnelPaymentRepository.exist({
      where: {
        funnelId,
        customerEmail: customer.email,
        status: FunnelPaymentStatus.PAID,
      },
    });
  }

  private async customerHasUnpaidPaymentOnFunnel(
    funnelId: number,
    customerId: number,
  ): Promise<boolean> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      return false;
    }

    return this.funnelPaymentRepository.exist({
      where: {
        funnelId,
        customerEmail: customer.email,
        status: In([
          FunnelPaymentStatus.PENDING,
          FunnelPaymentStatus.FAILED,
          FunnelPaymentStatus.CANCELLED,
        ]),
      },
    });
  }
}
