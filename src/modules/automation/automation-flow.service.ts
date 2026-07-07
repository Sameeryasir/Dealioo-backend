import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import { isCronTriggerAutomationNode } from './automation-cron.config';

export type AutomationExecutionPlan = {
  nodes: AutomationNode[];
  startNodeId: number;
  endNodeId: number;
  /** First email step in the flow (payment reminder). */
  emailNode: AutomationNode | null;
  /** Second email step (QR pass guide), if configured. */
  passEmailNode: AutomationNode | null;
  /** Wait step between payment email and pass email. */
  waitBeforePassNode: AutomationNode | null;
  smsNode: AutomationNode | null;
  conditionNode: AutomationNode | null;
  sendToUnpaidOnly: boolean;
};

@Injectable()
export class AutomationFlowService {
  constructor(
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
  ) {}

  /** Manual Run button: start display on condition or action node, not the cron trigger. */
  resolveBulkRunStartNodeId(plan: AutomationExecutionPlan): number {
    if (plan.conditionNode) {
      return plan.conditionNode.id;
    }
    const actionNode = plan.emailNode ?? plan.smsNode;
    if (actionNode) {
      return actionNode.id;
    }
    return plan.startNodeId;
  }

  async buildExecutionPlan(automationId: number): Promise<AutomationExecutionPlan> {
    const nodes = await this.nodeRepository.find({
      where: { automationId },
      order: { order: 'ASC' },
    });

    if (nodes.length === 0) {
      throw new BadRequestException('Automation has no nodes. Build the flow first.');
    }

    let emailNode: AutomationNode | null = null;
    let passEmailNode: AutomationNode | null = null;
    let waitBeforePassNode: AutomationNode | null = null;
    let smsNode: AutomationNode | null = null;
    let conditionNode: AutomationNode | null = null;
    let sendToUnpaidOnly = false;

    const emailNodes: AutomationNode[] = [];

    for (const node of nodes) {
      if (node.type === AutomationNodeType.EMAIL) {
        emailNodes.push(node);
      }
      if (node.type === AutomationNodeType.SMS) {
        smsNode = node;
      }
      if (isCronTriggerAutomationNode(node)) {
        sendToUnpaidOnly = true;
      }
      if (node.type === AutomationNodeType.CONDITION) {
        conditionNode = node;
        if (this.conditionTargetsUnpaidCustomers(node.config ?? {})) {
          sendToUnpaidOnly = true;
        }
      }
    }

    if (emailNodes.length > 0) {
      emailNode = emailNodes[0];
    }
    if (emailNodes.length > 1) {
      passEmailNode = emailNodes[1];
      waitBeforePassNode =
        nodes.find(
          (node) =>
            node.type === AutomationNodeType.WAIT &&
            node.order > emailNodes[0].order &&
            node.order < emailNodes[1].order,
        ) ??
        nodes.find(
          (node) =>
            node.type === AutomationNodeType.WAIT &&
            node.order > emailNodes[0].order,
        ) ??
        null;
    }

    if (!emailNode && !smsNode) {
      throw new BadRequestException(
        'Flow must include an email or SMS node (check node_order and type).',
      );
    }

    return {
      nodes,
      startNodeId: nodes[0].id,
      endNodeId: nodes[nodes.length - 1].id,
      emailNode,
      passEmailNode,
      waitBeforePassNode,
      smsNode,
      conditionNode,
      sendToUnpaidOnly,
    };
  }

  conditionTargetsUnpaidCustomers(config: Record<string, unknown>): boolean {
    const label = String(
      config.conditionType ?? config.type ?? config.label ?? '',
    ).toLowerCase();

    return (
      label.includes('not completed payment') ||
      label.includes('has not paid') ||
      label.includes('not paid') ||
      label.includes('payment_not_paid') ||
      label === 'payment_not_paid'
    );
  }
}
