import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';

export type AutomationExecutionPlan = {
  nodes: AutomationNode[];
  startNodeId: number;
  endNodeId: number;
  emailNode: AutomationNode | null;
  conditionNode: AutomationNode | null;
  sendToUnpaidOnly: boolean;
};

@Injectable()
export class AutomationFlowService {
  constructor(
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
  ) {}

  /** Manual Run button: start display on condition or email, not the cron trigger. */
  resolveBulkRunStartNodeId(plan: AutomationExecutionPlan): number {
    if (plan.conditionNode) {
      return plan.conditionNode.id;
    }
    if (plan.emailNode) {
      return plan.emailNode.id;
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
    let conditionNode: AutomationNode | null = null;
    let sendToUnpaidOnly = false;

    for (const node of nodes) {
      if (node.type === AutomationNodeType.EMAIL) {
        emailNode = node;
      }
      if (node.type === AutomationNodeType.CONDITION) {
        conditionNode = node;
        if (this.conditionTargetsUnpaidCustomers(node.config ?? {})) {
          sendToUnpaidOnly = true;
        }
      }
    }

    if (!emailNode) {
      throw new BadRequestException(
        'Flow must include an email node (check node_order and type).',
      );
    }

    return {
      nodes,
      startNodeId: nodes[0].id,
      endNodeId: nodes[nodes.length - 1].id,
      emailNode,
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
