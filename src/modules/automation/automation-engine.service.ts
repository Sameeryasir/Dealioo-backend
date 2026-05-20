import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
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
import {
  resolveAutomationEmailTemplateFromPurpose,
  resolveAutomationEmailTemplateId,
} from '../../templates/automation/registry';
import { AutomationEmailRendererService } from './automation-email-renderer.service';
import { AutomationMailService } from './automation-mail.service';
import { AutomationQueueService } from './automation-queue.service';
import { MAX_AUTOMATION_EXECUTION_STEPS } from './automation-queue.constants';

type NodeRunResult = 'advance' | 'wait' | 'complete' | 'failed';

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  constructor(
    private readonly executionService: AutomationExecutionService,
    private readonly logService: AutomationLogService,
    private readonly mailService: AutomationMailService,
    private readonly emailRenderer: AutomationEmailRendererService,
    private readonly queueService: AutomationQueueService,
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
  ) {}

  async processExecution(executionId: number, nodeId: number): Promise<void> {
    let execution = await this.executionService.findById(executionId);

    if (
      execution.status === AutomationExecutionStatus.COMPLETED ||
      execution.status === AutomationExecutionStatus.FAILED
    ) {
      return;
    }

    const stepCount = await this.logService.countByExecutionId(executionId);
    if (stepCount >= MAX_AUTOMATION_EXECUTION_STEPS) {
      const message = `Workflow exceeded maximum steps (${MAX_AUTOMATION_EXECUTION_STEPS})`;
      this.logger.warn(`Execution ${executionId}: ${message}`);
      await this.logService.createLog({
        executionId,
        nodeId,
        customerId: execution.customerId,
        message: 'Workflow stopped (step limit)',
        error: message,
      });
      await this.executionService.markFailed(executionId, message);
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
        nodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );
      execution = await this.executionService.findById(executionId);
    } else if (execution.currentNodeId !== nodeId) {
      await this.executionService.updateCurrentNode(
        executionId,
        nodeId,
        AutomationExecutionStatus.RUNNING,
        null,
      );
      execution = await this.executionService.findById(executionId);
    }

    const node = await this.executionService.findNodeForAutomation(
      execution.automationId,
      nodeId,
    );

    this.logger.log(
      `Execution ${executionId}: running node ${node.id} (${node.type})`,
    );

    try {
      const result = await this.runNode(execution, node);
      await this.handleNodeResult(executionId, execution, node.id, result);
      this.logger.log(
        `Execution ${executionId}: finished node ${node.id} (${node.type}) → ${result}`,
      );
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
      await this.executionService.markFailed(executionId, message);
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

    const advanced = await this.advanceToNextNode(
      executionId,
      execution.automationId,
      execution.currentNodeId,
      execution.customerId,
    );
    if (!advanced) {
      await this.logService.createLog({
        executionId,
        nodeId: execution.currentNodeId,
        customerId: execution.customerId,
        message: 'Workflow completed',
      });
      await this.executionService.markCompleted(executionId);
    }
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

    const advanced = await this.advanceToNextNode(
      executionId,
      execution.automationId,
      nodeId,
      execution.customerId,
    );
    if (!advanced) {
      await this.logService.createLog({
        executionId,
        nodeId,
        customerId: execution.customerId,
        message: 'Workflow completed',
      });
      await this.executionService.markCompleted(executionId);
    }
  }

  private async advanceToNextNode(
    executionId: number,
    automationId: number,
    currentNodeId: number,
    customerId: number,
  ): Promise<boolean> {
    const nextNodeId = await this.executionService.getNextNodeId(
      automationId,
      currentNodeId,
    );

    if (!nextNodeId) {
      return false;
    }

    if (nextNodeId === currentNodeId) {
      await this.failExecutionCycle(
        executionId,
        currentNodeId,
        customerId,
        'Workflow cycle detected (node points to itself)',
      );
      return false;
    }

    const visited = await this.logService.getVisitedNodeIds(executionId);
    if (visited.includes(nextNodeId)) {
      await this.failExecutionCycle(
        executionId,
        currentNodeId,
        customerId,
        'Workflow cycle detected (revisited node)',
      );
      return false;
    }

    await this.executionService.updateCurrentNode(
      executionId,
      nextNodeId,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    await this.queueService.addProcessExecution({
      executionId,
      nodeId: nextNodeId,
    });
    return true;
  }

  private async failExecutionCycle(
    executionId: number,
    nodeId: number,
    customerId: number,
    message: string,
  ): Promise<void> {
    this.logger.warn(`Execution ${executionId}: ${message}`);
    await this.logService.createLog({
      executionId,
      nodeId,
      customerId,
      message: 'Workflow stopped (cycle)',
      error: message,
    });
    await this.executionService.markFailed(executionId, message);
  }

  private async runNode(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    node: NonNullable<
      Awaited<ReturnType<AutomationExecutionService['findById']>>['currentNode']
    >,
  ): Promise<NodeRunResult> {
    const config = node.config ?? {};

    switch (node.type) {
      case AutomationNodeType.TRIGGER: {
        const triggerLabel = String(
          config.trigger ??
            config.triggerType ??
            config.event ??
            execution.automation?.trigger ??
            'trigger',
        );
        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: `Trigger fired (${triggerLabel}) — starting workflow`,
        });
        return 'advance';
      }

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
        await this.queueService.addResumeExecution(
          { executionId: execution.id },
          delayMinutes * 60_000,
        );
        return 'wait';
      }

      case AutomationNodeType.EMAIL: {
        const campaignName =
          execution.automation?.campaign?.campaignName?.trim() ||
          'the campaign';

        const rawTemplate = String(config.templateId ?? config.template ?? '').trim();
        const templateLooksAbandoned = rawTemplate
          .toLowerCase()
          .includes('abandoned');

        let subject = String(config.subject ?? '').trim();
        if (execution.automation?.purpose === AutomationPurpose.FUNNEL_SIGNUP) {
          if (!subject) {
            subject = `Thanks for signing up on ${campaignName}!`;
          }
        }
        if (execution.automation?.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
          if (!subject || templateLooksAbandoned) {
            subject = `Thank you for trusting us — your payment is confirmed`;
          }
        }

        const templateKey = this.resolveEmailTemplateKey(
          execution.automation.purpose,
          rawTemplate,
        );

        const to = execution.customer?.email?.trim();
        const customerName =
          execution.customer?.name?.trim() || to?.split('@')[0] || 'there';

        let defaultMessage: string | undefined;
        if (execution.automation?.purpose === AutomationPurpose.FUNNEL_SIGNUP) {
          defaultMessage = `Thank you for signing up on ${campaignName}! Your registration was successful and we are excited to have you with us. We will keep you updated on what happens next.`;
        } else if (execution.automation?.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
          defaultMessage = `Thank you for trusting us. Your payment is confirmed. We are glad to have you with us on ${campaignName}.`;
        }

        let emailSent = false;
        let emailError: string | null = null;

        if (to && subject) {
          try {
            this.logger.log(
              `Execution ${execution.id}: rendering email (${execution.automation.purpose}) for ${to}`,
            );
            const { html, text } = await this.emailRenderer.render(templateKey, {
              customerName,
              customerEmail: to,
              subject,
              message: config.message
                ? String(config.message)
                : config.body
                  ? String(config.body)
                  : defaultMessage,
              headline: config.headline
                ? String(config.headline)
                : execution.automation?.purpose === AutomationPurpose.FUNNEL_SIGNUP
                  ? 'Thanks for signing up!'
                  : execution.automation?.purpose === AutomationPurpose.FUNNEL_PAYMENT
                    ? 'Your payment is confirmed'
                    : undefined,
              ctaLabel: config.ctaLabel ? String(config.ctaLabel) : undefined,
              ctaUrl: config.ctaUrl ? String(config.ctaUrl) : undefined,
            });
            this.logger.log(
              `Execution ${execution.id}: sending email to ${to}`,
            );
            await this.mailService.send({ to, subject, html, text });
            await this.executionService.incrementEmailsSent(execution.id);
            emailSent = true;
          } catch (error) {
            emailError =
              error instanceof Error ? error.message : 'Email send failed';
            this.logger.error(
              `Execution ${execution.id}: email failed for ${to}: ${emailError}`,
            );
          }
        }

        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: emailSent
            ? `Email sent to ${to}`
            : to && subject
              ? `Email failed: ${emailError ?? 'unknown error'}`
              : to
                ? 'Email skipped (missing subject)'
                : 'Email skipped (missing customer email)',
          error: emailError,
        });

        if (to && subject && !emailSent) {
          return 'failed';
        }

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
        const conditionType = String(
          config.conditionType ?? config.type ?? '',
        );
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

  private resolveEmailTemplateKey(
    purpose: AutomationPurpose,
    rawTemplate: string,
  ): string {
    if (
      purpose === AutomationPurpose.FUNNEL_SIGNUP ||
      purpose === AutomationPurpose.FUNNEL_PAYMENT
    ) {
      return resolveAutomationEmailTemplateFromPurpose(purpose);
    }
    if (rawTemplate) {
      return resolveAutomationEmailTemplateId(rawTemplate);
    }
    return resolveAutomationEmailTemplateFromPurpose(purpose);
  }

  private async shouldStopAfterCondition(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    conditionType: string,
  ): Promise<boolean> {
    const funnelId = execution.automation.funnelId;
    if (!funnelId) {
      return false;
    }

    const normalized = conditionType.toLowerCase();
    if (
      normalized.includes('not completed payment') ||
      normalized.includes('not paid') ||
      normalized === 'payment_not_paid'
    ) {
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
