import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import { AutomationExecutionStatus } from '../../db/entities/automation-execution.entity';
import { AutomationExecutionEventType } from '../../db/entities/automation-execution-event.entity';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import type { AutomationExecution } from '../../db/entities/automation-execution.entity';
import { Customer } from '../../db/entities/customer.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { CouponStatus } from '../../db/entities/coupon.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { ActivityService } from '../activity/activity.service';
import { ChatMessageService } from '../chat/chat-message.service';
import { ConversationMessageChannel } from '../../db/entities/conversation-message.entity';
import { CouponService } from '../redemption/coupon.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationEmailService } from './automation-email.service';
import { AutomationQueueService } from './automation-queue.service';
import { AutomationConditionRegistry } from './automation-condition.registry';
import { AutomationExecutionEventService } from './automation-execution-event.service';
import { normalizeExecutionContext } from './automation-execution-context.types';
import { AutomationMetricsService } from './automation-metrics.service';
import { resolveWaitDelayMinutes } from './automation-wait.util';
import {
  hasConditionLoopRestartConfig,
  isUnpaidGuestCondition,
} from './automation-payment-condition.util';
import { isCustomerVisitedCondition } from './automation-visit.util';

type NodeRunResult = 'advance' | 'wait' | 'complete' | 'failed';

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  constructor(
    private readonly executionService: AutomationExecutionService,
    private readonly logService: AutomationLogService,
    private readonly automationEmailService: AutomationEmailService,
    private readonly queueService: AutomationQueueService,
    private readonly eventService: AutomationExecutionEventService,
    private readonly conditionRegistry: AutomationConditionRegistry,
    private readonly metricsService: AutomationMetricsService,
    @InjectRepository(FunnelEvent)
    private readonly funnelEventRepository: Repository<FunnelEvent>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(CustomerVisit)
    private readonly customerVisitRepository: Repository<CustomerVisit>,
    private readonly couponService: CouponService,
    private readonly activityService: ActivityService,
    private readonly chatMessageService: ChatMessageService,
  ) {}

  async processExecution(executionId: number, nodeId: number): Promise<void> {
    let execution = await this.executionService.findById(executionId);

    if (execution.status === AutomationExecutionStatus.PAUSED) {
      return;
    }

    if (!execution.automation?.isActive) {
      await this.executionService.pauseExecution(executionId);
      return;
    }

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
      if (execution.currentNodeId !== nodeId) {
        this.logger.warn(
          `Execution ${executionId}: ignoring stale process job for node ${nodeId} while waiting on ${execution.currentNodeId}`,
        );
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
      `Execution ${executionId}: running node ${node.id} (${node.type})${
        execution.automation?.purpose === AutomationPurpose.FUNNEL_PAYMENT
          ? ' [Prepaid Offer]'
          : ''
      }`,
    );

    await this.recordExecutionEvent(
      execution,
      AutomationExecutionEventType.NODE_ENTERED,
      node.id,
      { nodeType: node.type },
    );

    const startedAt = Date.now();

    try {
      const result = await this.runNode(execution, node);
      this.metricsService.recordNodeExecution(
        node.type,
        result,
        Date.now() - startedAt,
      );
      await this.recordExecutionEvent(
        execution,
        AutomationExecutionEventType.NODE_COMPLETED,
        node.id,
        { nodeType: node.type, result },
      );
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
      this.metricsService.recordNodeFailure(node.type);
      await this.recordExecutionEvent(
        execution,
        AutomationExecutionEventType.NODE_FAILED,
        node.id,
        { nodeType: node.type, error: message },
      );
      await this.executionService.markFailed(executionId, message);
      this.metricsService.recordExecutionFailed();
    }
  }

  async resumeAfterWait(executionId: number): Promise<void> {
    const execution = await this.executionService.findById(executionId);
    if (execution.status === AutomationExecutionStatus.PAUSED) {
      return;
    }
    if (!execution.automation?.isActive) {
      await this.executionService.pauseExecution(executionId);
      return;
    }
    if (execution.status !== AutomationExecutionStatus.WAITING) {
      return;
    }

    const waitNodeId = await this.resolveWaitNodeIdForResume(execution);
    if (!waitNodeId) {
      this.logger.warn(
        `Execution ${executionId}: could not resolve wait node for resume`,
      );
      return;
    }

    await this.logService.createLog({
      executionId,
      nodeId: waitNodeId,
      customerId: execution.customerId,
      message: 'Wait completed',
    });
    await this.recordExecutionEvent(
      execution,
      AutomationExecutionEventType.WAIT_COMPLETED,
      waitNodeId,
    );

    const advanced = await this.advanceToNextNode(
      executionId,
      execution.automationId,
      waitNodeId,
      execution.customerId,
      { skipCycleCheck: true },
    );
    if (!advanced) {
      const refreshed = await this.executionService.findById(executionId);
      if (refreshed.status === AutomationExecutionStatus.FAILED) {
        return;
      }
      await this.logService.createLog({
        executionId,
        nodeId: waitNodeId,
        customerId: execution.customerId,
        message: 'Workflow completed',
      });
      await this.recordExecutionEvent(
        refreshed,
        AutomationExecutionEventType.EXECUTION_COMPLETED,
        waitNodeId,
      );
      await this.executionService.markCompleted(executionId);
      this.metricsService.recordExecutionCompleted();
    }
  }

  private async resolveWaitNodeIdForResume(
    execution: AutomationExecution,
  ): Promise<number | null> {
    const currentNode = await this.executionService.findNodeForAutomation(
      execution.automationId,
      execution.currentNodeId,
    );
    if (currentNode.type === AutomationNodeType.WAIT) {
      return currentNode.id;
    }

    return this.logService.findLastScheduledWaitNodeId(execution.id);
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
      await this.recordExecutionEvent(
        execution,
        AutomationExecutionEventType.EXECUTION_COMPLETED,
        nodeId,
      );
      await this.executionService.markCompleted(executionId);
      this.metricsService.recordExecutionCompleted();
      return;
    }

    if (result === 'failed') {
      await this.recordExecutionEvent(
        execution,
        AutomationExecutionEventType.EXECUTION_FAILED,
        nodeId,
      );
      await this.executionService.markFailed(executionId);
      this.metricsService.recordExecutionFailed();
      return;
    }

    const advanced = await this.advanceToNextNode(
      executionId,
      execution.automationId,
      nodeId,
      execution.customerId,
      {
        skipCycleCheck:
          execution.automation?.purpose === AutomationPurpose.FUNNEL_PAYMENT ||
          execution.automation?.purpose ===
            AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER,
      },
    );
    if (!advanced) {
      const refreshed = await this.executionService.findById(executionId);
      if (refreshed.status === AutomationExecutionStatus.FAILED) {
        return;
      }
      await this.logService.createLog({
        executionId,
        nodeId,
        customerId: execution.customerId,
        message: 'Workflow completed',
      });
      await this.recordExecutionEvent(
        refreshed,
        AutomationExecutionEventType.EXECUTION_COMPLETED,
        nodeId,
      );
      await this.executionService.markCompleted(executionId);
      this.metricsService.recordExecutionCompleted();
    }
  }

  private async advanceToNextNode(
    executionId: number,
    automationId: number,
    currentNodeId: number,
    customerId: number,
    options?: { skipCycleCheck?: boolean },
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

    if (!options?.skipCycleCheck) {
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
    }

    await this.executionService.updateCurrentNode(
      executionId,
      nextNodeId,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    const nextNode = await this.executionService.findNodeForAutomation(
      automationId,
      nextNodeId,
    );
    await this.queueService.addProcessExecution({
      executionId,
      nodeId: nextNodeId,
      nodeType: nextNode.type,
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
        await this.recordExecutionEvent(
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
        return 'advance';
      }

      case AutomationNodeType.WAIT: {
        const delayMinutes = resolveWaitDelayMinutes(config);
        if (delayMinutes <= 0) {
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
        await this.recordExecutionEvent(
          execution,
          AutomationExecutionEventType.WAIT_SCHEDULED,
          node.id,
          { delayMinutes, scheduledAt: scheduledAt.toISOString() },
        );
        await this.queueService.addResumeExecution(
          { executionId: execution.id },
          delayMinutes * 60_000,
        );
        return 'wait';
      }

      case AutomationNodeType.EMAIL: {
        if (!(await this.ensureExecutionStillRunnable(execution.id))) {
          return 'complete';
        }

        const campaignName =
          execution.automation?.campaign?.campaignName?.trim() ||
          'the campaign';
        const purpose = execution.automation.purpose;
        const to = execution.customer?.email?.trim();

        this.logger.log(
          `Execution ${execution.id}: sending email (${purpose}) for ${to ?? 'unknown'}`,
        );

        const emailConfig = await this.enrichPaymentEmailConfig(
          purpose,
          execution,
          (config ?? {}) as Record<string, unknown>,
          node.id,
        );

        const prepared = this.automationEmailService.prepareFromEmailNode(
          emailConfig,
          purpose,
          { campaignName },
        );

        const chatIdempotencyKey = this.resolveAutomationChatIdempotencyKey(
          execution,
          node.id,
        );
        if (await this.chatMessageService.hasOutboundMessage(chatIdempotencyKey)) {
          this.logger.log(
            `Execution ${execution.id}: skipping duplicate email for key ${chatIdempotencyKey}`,
          );
          return 'advance';
        }

        const sendResult = await this.automationEmailService.sendToCustomer(
          purpose,
          {
            customerId: execution.customerId,
            email: to ?? '',
            name: execution.customer?.name ?? '',
          },
          emailConfig,
          campaignName,
        );

        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: sendResult.sent
            ? `Email sent to ${to}`
            : to
              ? `Email failed: ${sendResult.error ?? 'unknown error'}`
              : 'Email skipped (missing customer email)',
          error: sendResult.error,
        });

      if (sendResult.sent) {
        await this.executionService.incrementEmailsSent(execution.id);
        this.metricsService.recordEmailSend(true);
        await this.recordAutomationEmailInChat(
          execution,
          node.id,
          purpose,
          prepared,
          to ?? '',
        );
        return 'advance';
      }

        if (to && sendResult.error) {
          this.metricsService.recordEmailSend(false);
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

        if (isCustomerVisitedCondition(conditionType)) {
          const registryResult = await this.conditionRegistry.evaluate({
            execution,
            node,
            conditionType,
            config,
          });
          const visited =
            registryResult ??
            (await this.customerHasVisitedForAutomation(execution));

          const context = this.eventService.mergeContext(
            execution.executionContext,
            {
              lastConditionType: conditionType,
              lastConditionResult: visited,
            },
          );
          await this.executionService.updateExecutionContext(
            execution.id,
            context as Record<string, unknown>,
          );
          execution.executionContext = context as Record<string, unknown>;

          await this.recordExecutionEvent(
            execution,
            AutomationExecutionEventType.CONDITION_EVALUATED,
            node.id,
            { conditionType, visited },
          );

          if (visited) {
            await this.logService.createLog({
              executionId: execution.id,
              nodeId: node.id,
              customerId: execution.customerId,
              message: 'Customer visited and redeemed — continuing workflow',
            });
            return 'advance';
          }

          const loopConfig = {
            ...config,
            onFalseLoopWorkflowKind:
              String(config.onFalseLoopWorkflowKind ?? '').trim() ===
              'prepaid_payment_actions'
                ? 'prepaid_visit_reminder_wait'
                : (config.onFalseLoopWorkflowKind ??
                  'prepaid_visit_reminder_wait'),
          };
          const loopNode = await this.resolvePrepaidVisitLoopNode(
            execution.automationId,
            loopConfig,
          );
          if (!loopNode) {
            await this.logService.createLog({
              executionId: execution.id,
              nodeId: node.id,
              customerId: execution.customerId,
              message: 'Customer has not visited — could not restart flow',
              error: 'Missing loop target for prepaid visit branch',
            });
            return 'failed';
          }

          await this.logService.createLog({
            executionId: execution.id,
            nodeId: node.id,
            customerId: execution.customerId,
            message:
              'Customer has not visited — waiting before visit reminder email',
          });

          return this.restartExecutionAtLoopNode(execution, node, loopNode);
        }

        if (
          isUnpaidGuestCondition(conditionType) &&
          hasConditionLoopRestartConfig(config)
        ) {
          const funnelId = execution.automation.funnelId;
          const paid =
            funnelId != null &&
            (await this.customerHasPaidOnFunnel(
              funnelId,
              execution.customerId,
            ));

          await this.recordExecutionEvent(
            execution,
            AutomationExecutionEventType.CONDITION_EVALUATED,
            node.id,
            { conditionType, paid },
          );

          if (paid) {
            await this.logService.createLog({
              executionId: execution.id,
              nodeId: node.id,
              customerId: execution.customerId,
              message: 'Guest completed payment — workflow stops',
            });
            return 'complete';
          }

          const loopNode =
            await this.executionService.findPaymentReminderLoopRestartNode(
              execution.automationId,
              config,
            );
          if (!loopNode) {
            await this.logService.createLog({
              executionId: execution.id,
              nodeId: node.id,
              customerId: execution.customerId,
              message: 'Guest still unpaid — could not restart reminder loop',
              error: 'Missing loop target for payment reminder branch',
            });
            return 'failed';
          }

          await this.logService.createLog({
            executionId: execution.id,
            nodeId: node.id,
            customerId: execution.customerId,
            message:
              'Guest still unpaid — sending reminder emails again after wait',
          });

          return this.restartExecutionAtLoopNode(execution, node, loopNode);
        }

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
        return this.runRewardCouponNode(execution, node, config);

      case AutomationNodeType.TAG: {
        if (String(config.workflowKind ?? '') === 'prepaid_payment_actions') {
          return this.runPrepaidPaymentActionsNode(execution, node, config);
        }

        if (String(config.workflowKind ?? '') === 'actions') {
          return this.runBundledActionsNode(execution, node, config);
        }

        await this.logService.createLog({
          executionId: execution.id,
          nodeId: node.id,
          customerId: execution.customerId,
          message: `Tag applied (${String(config.tag ?? 'default')})`,
        });
        return 'advance';
      }

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

    const normalized = conditionType.toLowerCase();
    if (
      normalized.includes('not prepaid') ||
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

  private async runPrepaidPaymentActionsNode(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    node: NonNullable<
      Awaited<ReturnType<AutomationExecutionService['findById']>>['currentNode']
    >,
    config: Record<string, unknown>,
  ): Promise<NodeRunResult> {
    if (!(await this.ensureExecutionStillRunnable(execution.id))) {
      return 'complete';
    }

    this.logger.log(
      `[Prepaid Offer] Running prepaid payment actions — execution ${execution.id} customer ${execution.customerId} node ${node.id}`,
    );

    const actions = Array.isArray(config.actions) ? config.actions : [];
    const purpose = execution.automation.purpose;
    const campaignName =
      execution.automation?.campaign?.campaignName?.trim() || 'the campaign';
    const to = execution.customer?.email?.trim() ?? '';
    let emailFailed = false;

    for (const rawAction of actions) {
      if (!rawAction || typeof rawAction !== 'object') {
        continue;
      }

      if (!(await this.ensureExecutionStillRunnable(execution.id))) {
        return 'complete';
      }

      const action = rawAction as Record<string, unknown>;
      const actionType = String(action.type ?? '').trim().toLowerCase();

      if (actionType !== 'send_email') {
        continue;
      }

      const emailConfig = await this.enrichPaymentEmailConfig(
        purpose,
        execution,
        action,
        node.id,
      );

      const prepared = this.automationEmailService.prepareFromEmailNode(
        emailConfig,
        purpose,
        { campaignName },
      );

      const chatIdempotencyKey = this.resolveAutomationChatIdempotencyKey(
        execution,
        node.id,
      );
      if (await this.chatMessageService.hasOutboundMessage(chatIdempotencyKey)) {
        this.logger.log(
          `[Prepaid Offer] Skipping duplicate email for execution ${execution.id} key ${chatIdempotencyKey}`,
        );
        continue;
      }

      const sendResult = await this.automationEmailService.sendToCustomer(
        purpose,
        {
          customerId: execution.customerId,
          email: to,
          name: execution.customer?.name ?? '',
        },
        emailConfig,
        campaignName,
      );

      await this.logService.createLog({
        executionId: execution.id,
        nodeId: node.id,
        customerId: execution.customerId,
        message: sendResult.sent
          ? `Email sent to ${to}`
          : to
            ? `Email failed: ${sendResult.error ?? 'unknown error'}`
            : 'Email skipped (missing customer email)',
        error: sendResult.error,
      });

      if (sendResult.sent) {
        await this.executionService.incrementEmailsSent(execution.id);
        await this.recordAutomationEmailInChat(
          execution,
          node.id,
          purpose,
          prepared,
          to,
        );
      } else if (to && sendResult.error) {
        emailFailed = true;
      }
    }

    return emailFailed ? 'failed' : 'advance';
  }

  private async runRewardCouponNode(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    node: NonNullable<
      Awaited<ReturnType<AutomationExecutionService['findById']>>['currentNode']
    >,
    config: Record<string, unknown>,
  ): Promise<NodeRunResult> {
    const purpose = execution.automation.purpose;
    const campaignName =
      execution.automation?.campaign?.campaignName?.trim() || 'the campaign';
    const rewardName = String(config.rewardName ?? 'Return visit offer').trim();
    const expirationNote = String(
      config.expirationNote ?? config.expiration ?? '',
    ).trim();
    const to = execution.customer?.email?.trim() ?? '';

    await this.logService.createLog({
      executionId: execution.id,
      nodeId: node.id,
      customerId: execution.customerId,
      message: `Reward offer prepared (${rewardName})`,
    });

    if (!to) {
      await this.logService.createLog({
        executionId: execution.id,
        nodeId: node.id,
        customerId: execution.customerId,
        message: 'Reward email skipped (missing customer email)',
      });
      return 'advance';
    }

    const subject =
      String(config.subject ?? '').trim() || `Your ${rewardName} is ready`;
    const defaultMessage = expirationNote
      ? `Hi [First Name] — we'd love to see you again! Your ${rewardName} is ready.\n\n${expirationNote}`
      : `Hi [First Name] — we'd love to see you again! Your ${rewardName} is ready.`;
    const message = String(config.message ?? '').trim() || defaultMessage;

    const emailConfig = await this.enrichPaymentEmailConfig(
      purpose,
      execution,
      {
        subject,
        message,
        headline: rewardName,
        ctaLabel: String(config.ctaLabel ?? '').trim() || undefined,
      },
      node.id,
    );

    const prepared = this.automationEmailService.prepareFromEmailNode(
      emailConfig,
      purpose,
      { campaignName },
    );

    const sendResult = await this.automationEmailService.sendToCustomer(
      purpose,
      {
        customerId: execution.customerId,
        email: to,
        name: execution.customer?.name ?? '',
      },
      emailConfig,
      campaignName,
    );

    await this.logService.createLog({
      executionId: execution.id,
      nodeId: node.id,
      customerId: execution.customerId,
      message: sendResult.sent
        ? `Reward email sent to ${to}`
        : `Reward email failed: ${sendResult.error ?? 'unknown error'}`,
      error: sendResult.error,
    });

    if (sendResult.sent) {
      await this.executionService.incrementEmailsSent(execution.id);
      await this.recordAutomationEmailInChat(
        execution,
        node.id,
        purpose,
        prepared,
        to,
      );
      return 'advance';
    }

    return 'failed';
  }

  private async runBundledActionsNode(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    node: NonNullable<
      Awaited<ReturnType<AutomationExecutionService['findById']>>['currentNode']
    >,
    config: Record<string, unknown>,
  ): Promise<NodeRunResult> {
    const actions = Array.isArray(config.actions) ? config.actions : [];
    const purpose = execution.automation.purpose;
    const campaignName =
      execution.automation?.campaign?.campaignName?.trim() || 'the campaign';
    const to = execution.customer?.email?.trim() ?? '';
    const customerName = execution.customer?.name ?? '';

    if (!to) {
      await this.logService.createLog({
        executionId: execution.id,
        nodeId: node.id,
        customerId: execution.customerId,
        message: 'Actions skipped (missing customer email)',
      });
      return 'advance';
    }

    let sentCount = 0;
    let lastError: string | undefined;

    for (const rawAction of actions) {
      if (!rawAction || typeof rawAction !== 'object') {
        continue;
      }
      const action = rawAction as Record<string, unknown>;
      if (String(action.type) !== 'send_text') {
        continue;
      }

      const message = String(action.message ?? '').trim();
      if (!message) {
        continue;
      }

      const sendResult = await this.automationEmailService.sendToCustomer(
        purpose,
        {
          customerId: execution.customerId,
          email: to,
          name: customerName,
        },
        { message },
        campaignName,
      );

      if (sendResult.sent) {
        sentCount += 1;
        await this.executionService.incrementEmailsSent(execution.id);
      } else if (sendResult.error) {
        lastError = sendResult.error;
      }
    }

    await this.logService.createLog({
      executionId: execution.id,
      nodeId: node.id,
      customerId: execution.customerId,
      message:
        sentCount > 0
          ? `Actions sent ${sentCount} email(s) to ${to}`
          : 'Actions completed — no emails sent',
      error: lastError,
    });

    if (lastError && sentCount === 0) {
      return 'failed';
    }

    return 'advance';
  }

  private resolveAutomationChatIdempotencyKey(
    execution: AutomationExecution,
    nodeId: number,
  ): string {
    const loopCount =
      normalizeExecutionContext(execution.executionContext).loopCount ?? 0;
    const paymentId =
      normalizeExecutionContext(execution.executionContext).funnelPaymentId ??
      null;

    if (
      execution.purpose === AutomationPurpose.FUNNEL_PAYMENT &&
      paymentId != null
    ) {
      return `chat_message:payment:${paymentId}:node:${nodeId}:customer:${execution.customerId}:loop:${loopCount}`;
    }

    return `chat_message:execution:${execution.id}:node:${nodeId}:customer:${execution.customerId}:loop:${loopCount}`;
  }

  private async ensureExecutionStillRunnable(
    executionId: number,
  ): Promise<boolean> {
    const refreshed = await this.executionService.findById(executionId);
    if (
      refreshed.status === AutomationExecutionStatus.COMPLETED ||
      refreshed.status === AutomationExecutionStatus.FAILED ||
      refreshed.status === AutomationExecutionStatus.PAUSED
    ) {
      this.logger.log(
        `Execution ${executionId}: skipping node — status is ${refreshed.status}`,
      );
      return false;
    }
    return true;
  }

  private async recordAutomationEmailInChat(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    nodeId: number,
    purpose: AutomationPurpose,
    prepared: Awaited<
      ReturnType<AutomationEmailService['prepareFromEmailNode']>
    >,
    to: string,
  ): Promise<void> {
    const idempotencyKey = this.resolveAutomationChatIdempotencyKey(
      execution,
      nodeId,
    );

    await this.activityService.logMessageSent({
      businessId: execution.automation.businessId,
      customerId: execution.customerId,
      messagePreview:
        this.automationEmailService.resolvePreparedEmailPreview(prepared),
      idempotencyKey: idempotencyKey.replace(
        /^chat_message:/,
        'message_sent:',
      ),
      metadata: {
        automationId: execution.automationId,
        automationExecutionId: execution.id,
        nodeId,
        purpose,
      },
    });

    const automationName =
      execution.automation?.name?.trim() ||
      `Automation #${execution.automationId}`;
    const campaignName =
      execution.automation?.campaign?.campaignName?.trim() || null;
    const funnelId = execution.automation?.funnelId ?? null;
    const funnelName =
      campaignName || (funnelId != null ? `Funnel #${funnelId}` : null);

    await this.chatMessageService.recordOutboundMessage({
      businessId: execution.automation.businessId,
      customerId: execution.customerId,
      automationId: execution.automationId,
      executionId: execution.id,
      nodeId,
      channel: ConversationMessageChannel.EMAIL,
      bodyPreview: await this.automationEmailService.resolveRecipientChatMessageBody(
        prepared,
        {
          customerId: execution.customerId,
          email: to,
          name: execution.customer?.name ?? '',
        },
        purpose,
      ),
      idempotencyKey,
      metadata: {
        automationId: execution.automationId,
        automationExecutionId: execution.id,
        nodeId,
        purpose,
        automationName,
        campaignName,
        funnelId,
        funnelName,
      },
    });
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

  private async enrichPaymentEmailConfig(
    purpose: AutomationPurpose,
    execution: AutomationExecution,
    config: Record<string, unknown>,
    nodeId: number,
  ): Promise<Record<string, unknown>> {
    if (purpose !== AutomationPurpose.FUNNEL_PAYMENT) {
      return config;
    }

    const {
      qrImageDataUrl: _qrImageDataUrl,
      ...withoutQr
    } = config;

    const attachPassLink = await this.shouldAttachPassLink(execution, nodeId);
    if (!attachPassLink) {
      return withoutQr;
    }

    const passUrl = await this.resolvePassUrlForExecution(execution);
    if (!passUrl) {
      return withoutQr;
    }

    return {
      ...withoutQr,
      ctaUrl: String(withoutQr.ctaUrl ?? '').trim() || passUrl,
      ctaLabel: String(withoutQr.ctaLabel ?? '').trim() || 'View my pass',
    };
  }

  private async shouldAttachPassLink(
    execution: AutomationExecution,
    nodeId: number,
  ): Promise<boolean> {
    const node = await this.executionService.findNodeForAutomation(
      execution.automationId,
      nodeId,
    );
    const visitGateOrder =
      await this.executionService.findCustomerVisitedGateOrder(
        execution.automationId,
      );
    if (visitGateOrder == null) {
      return true;
    }

    return node.order < visitGateOrder;
  }

  private async resolvePassUrlForExecution(
    execution: AutomationExecution,
  ): Promise<string | null> {
    const funnelId = execution.automation?.funnelId;
    if (!funnelId) {
      return null;
    }

    const event = await this.funnelEventRepository.findOne({
      where: {
        customerId: execution.customerId,
        funnelId,
        funnelPaymentId: Not(IsNull()),
        eventType: FunnelEventType.PAYMENT,
      },
      order: { createdAt: 'DESC' },
    });

    if (!event?.funnelPaymentId) {
      return null;
    }

    const coupon = await this.couponService.findByPaymentId(
      event.funnelPaymentId,
    );
    if (!coupon) {
      return null;
    }

    return `${getFrontendBaseUrl()}/pass/${event.funnelPaymentId}`;
  }

  async resolvePostVisitResumeNodeId(
    execution: AutomationExecution,
  ): Promise<number | null> {
    if (execution.automation?.purpose !== AutomationPurpose.FUNNEL_PAYMENT) {
      return null;
    }

    if (await this.executionService.isExecutionPastVisitGateAsync(execution)) {
      return null;
    }

    const visited = await this.customerHasVisitedForAutomation(execution);
    if (!visited) {
      return null;
    }

    return this.executionService.findPostVisitEntryNodeId(
      execution.automationId,
    );
  }

  private async resolvePrepaidVisitLoopNode(
    automationId: number,
    config: Record<string, unknown>,
  ): Promise<AutomationNode | null> {
    return this.executionService.findPrepaidLoopRestartNode(
      automationId,
      config,
    );
  }

  private async restartExecutionAtLoopNode(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
    conditionNode: NonNullable<
      Awaited<ReturnType<AutomationExecutionService['findById']>>['currentNode']
    >,
    loopNode: AutomationNode,
  ): Promise<NodeRunResult> {
    const loopContext = this.eventService.mergeContext(
      execution.executionContext,
      {
        loopCount:
          (normalizeExecutionContext(execution.executionContext).loopCount ??
            0) + 1,
        branchMemory: { lastLoopTargetNodeId: loopNode.id },
      },
    );
    await this.executionService.updateExecutionContext(
      execution.id,
      loopContext as Record<string, unknown>,
    );
    execution.executionContext = loopContext as Record<string, unknown>;
    this.metricsService.recordPrepaidLoopRestart();

    await this.recordExecutionEvent(
      execution,
      AutomationExecutionEventType.LOOP_RESTART,
      conditionNode.id,
      { loopTargetNodeId: loopNode.id },
    );

    await this.executionService.updateCurrentNode(
      execution.id,
      loopNode.id,
      AutomationExecutionStatus.RUNNING,
      null,
    );
    await this.queueService.addProcessExecution({
      executionId: execution.id,
      nodeId: loopNode.id,
      nodeType: loopNode.type,
    });
    return 'wait';
  }

  private async customerHasVisitedForAutomation(
    execution: Awaited<ReturnType<AutomationExecutionService['findById']>>,
  ): Promise<boolean> {
    const campaignId = execution.automation?.campaignId;
    if (!campaignId) {
      return false;
    }

    if (execution.automation?.purpose === AutomationPurpose.FUNNEL_PAYMENT) {
      const funnelId = execution.automation.funnelId;
      if (!funnelId) {
        return false;
      }

      const event = await this.funnelEventRepository.findOne({
        where: {
          customerId: execution.customerId,
          funnelId,
          funnelPaymentId: Not(IsNull()),
          eventType: FunnelEventType.PAYMENT,
        },
        order: { createdAt: 'DESC' },
      });

      if (!event?.funnelPaymentId) {
        return false;
      }

      const coupon = await this.couponService.findLatestByPaymentId(
        event.funnelPaymentId,
      );
      if (!coupon) {
        return false;
      }

      return coupon.status === CouponStatus.REDEEMED;
    }

    return this.customerVisitRepository.exist({
      where: {
        customerId: execution.customerId,
        campaignId,
      },
    });
  }

  private async recordExecutionEvent(
    execution: AutomationExecution,
    eventType: AutomationExecutionEventType,
    nodeId?: number | null,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const refreshed = await this.executionService.findById(execution.id);
    const context = this.eventService.mergeContext(
      refreshed.executionContext,
      {
        stepHistoryPointer: refreshed.lastEventId ?? undefined,
      },
    );
    const snapshot = this.eventService.buildSnapshotFromExecution({
      ...refreshed,
      executionContext: context as Record<string, unknown>,
    });

    await this.eventService.appendEvent({
      executionId: execution.id,
      eventType,
      nodeId,
      snapshot,
      details,
    });
  }
}
