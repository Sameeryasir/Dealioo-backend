import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutomationConnection } from '../../../db/entities/automation-connection.entity';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../../db/entities/automation-node.entity';
import { AutomationTrigger } from '../../../db/entities/automation.entity';
import { AutomationNodeRegistry } from './automation-node-registry.service';

export type AutomationGraphValidationIssue = {
  code: string;
  message: string;
  nodeId?: number;
};

export type AutomationGraphValidationResult = {
  valid: boolean;
  issues: AutomationGraphValidationIssue[];
};

const TRIGGER_NODE_TYPES = new Set<AutomationNodeType>([
  AutomationNodeType.TRIGGER,
]);

@Injectable()
export class AutomationGraphValidatorService {
  constructor(
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
    @InjectRepository(AutomationConnection)
    private readonly connectionRepository: Repository<AutomationConnection>,
    private readonly nodeRegistry: AutomationNodeRegistry,
  ) {}

  async validateAutomationGraph(
    automationId: number,
    trigger: AutomationTrigger,
  ): Promise<AutomationGraphValidationResult> {
    const nodes = await this.nodeRepository.find({
      where: { automationId },
      order: { order: 'ASC', id: 'ASC' },
    });
    const connections = await this.connectionRepository.find({
      where: { automationId },
      order: { id: 'ASC' },
    });

    const issues: AutomationGraphValidationIssue[] = [];

    if (nodes.length === 0) {
      issues.push({
        code: 'NO_NODES',
        message: 'Automation must contain at least one workflow node.',
      });
      return { valid: false, issues };
    }

    const triggerNodes = nodes.filter((node) => node.type === AutomationNodeType.TRIGGER);
    if (triggerNodes.length === 0) {
      issues.push({
        code: 'MISSING_TRIGGER',
        message: 'Automation must include a trigger node.',
      });
    } else if (triggerNodes.length > 1) {
      issues.push({
        code: 'MULTIPLE_TRIGGERS',
        message: 'Automation must contain exactly one trigger node.',
        nodeId: triggerNodes[1]?.id,
      });
    }

    const nodeIds = new Set(nodes.map((node) => node.id));
    const outgoing = new Map<number, AutomationConnection[]>();
    const incomingCount = new Map<number, number>();

    for (const connection of connections) {
      if (!nodeIds.has(connection.sourceNodeId)) {
        issues.push({
          code: 'INVALID_CONNECTION_SOURCE',
          message: `Connection ${connection.id} references missing source node.`,
        });
        continue;
      }
      if (!nodeIds.has(connection.targetNodeId)) {
        issues.push({
          code: 'INVALID_CONNECTION_TARGET',
          message: `Connection ${connection.id} references missing target node.`,
        });
        continue;
      }

      const list = outgoing.get(connection.sourceNodeId) ?? [];
      list.push(connection);
      outgoing.set(connection.sourceNodeId, list);
      incomingCount.set(
        connection.targetNodeId,
        (incomingCount.get(connection.targetNodeId) ?? 0) + 1,
      );
    }

    const registeredMissing = this.nodeRegistry.assertAllTypesRegistered(
      [...new Set(nodes.map((node) => node.type))],
    );
    for (const type of registeredMissing) {
      if (!(Object.values(AutomationNodeType) as string[]).includes(type)) {
        issues.push({
          code: 'UNSUPPORTED_NODE_TYPE',
          message: `Unsupported node type "${type}".`,
        });
      }
    }

    for (const node of nodes) {
      if (node.type === AutomationNodeType.CONDITION) {
        this.validateConditionNode(node, outgoing.get(node.id) ?? [], issues);
      }

      if (
        node.type === AutomationNodeType.TRIGGER &&
        !this.triggerConfigMatchesAutomationTrigger(node, trigger)
      ) {
        issues.push({
          code: 'TRIGGER_MISMATCH',
          message: `Trigger node config does not match automation trigger "${trigger}".`,
          nodeId: node.id,
        });
      }

      const outs = outgoing.get(node.id) ?? [];
      if (
        node.type !== AutomationNodeType.CONDITION &&
        outs.length === 0 &&
        !this.isTerminalNode(node)
      ) {
        if (node.type === AutomationNodeType.TRIGGER) {
          issues.push({
            code: 'TRIGGER_NO_OUTGOING',
            message: 'Trigger node must connect to at least one next step.',
            nodeId: node.id,
          });
        }
      }
    }

    const startNodeId = triggerNodes[0]?.id;
    if (startNodeId != null) {
      const unreachable = this.findUnreachableNodeIds(
        startNodeId,
        nodeIds,
        outgoing,
      );
      for (const nodeId of unreachable) {
        const node = nodes.find((entry) => entry.id === nodeId);
        if (node && node.type !== AutomationNodeType.TRIGGER) {
          issues.push({
            code: 'UNREACHABLE_NODE',
            message: 'Node is not reachable from the trigger.',
            nodeId,
          });
        }
      }

      if (this.hasCycle(startNodeId, outgoing)) {
        issues.push({
          code: 'CYCLE_DETECTED',
          message:
            'Workflow graph contains a cycle. Loops are not supported yet.',
          nodeId: startNodeId,
        });
      }
    }

    return { valid: issues.length === 0, issues };
  }

  assertValidOrThrow(
    automationId: number,
    trigger: AutomationTrigger,
  ): Promise<void> {
    return this.validateAutomationGraph(automationId, trigger).then((result) => {
      if (result.valid) {
        return;
      }
      const summary = result.issues.map((issue) => issue.message).join(' ');
      throw new BadRequestException(
        `Automation graph is invalid: ${summary}`,
      );
    });
  }

  private validateConditionNode(
    node: AutomationNode,
    outgoing: AutomationConnection[],
    issues: AutomationGraphValidationIssue[],
  ): void {
    if (outgoing.length === 0) {
      issues.push({
        code: 'CONDITION_NO_BRANCHES',
        message: 'Condition node must connect to at least one branch.',
        nodeId: node.id,
      });
      return;
    }

    const branches = outgoing
      .map((connection) => connection.branch?.trim() || null)
      .filter((branch): branch is string => branch != null);

    if (outgoing.length > 1 && branches.length < outgoing.length) {
      const targets = new Set(outgoing.map((connection) => connection.targetNodeId));
      if (targets.size < outgoing.length) {
        issues.push({
          code: 'CONDITION_AMBIGUOUS_BRANCHES',
          message:
            'Condition node has multiple connections to the same target without branch labels.',
          nodeId: node.id,
        });
      }
    }
  }

  private triggerConfigMatchesAutomationTrigger(
    node: AutomationNode,
    trigger: AutomationTrigger,
  ): boolean {
    const config = node.config ?? {};
    const nodeTrigger = String(
      config.trigger ?? config.triggerType ?? config.event ?? '',
    )
      .trim()
      .toLowerCase();

    if (!nodeTrigger) {
      return true;
    }

    const normalized = trigger.toLowerCase();
    if (nodeTrigger === normalized) {
      return true;
    }

    const aliases: Record<string, string[]> = {
      signup: ['signup', 'user_signup', 'customer_signup'],
      payment: ['payment', 'payment_completed'],
      abandoned_checkout: ['abandoned_checkout', 'abandoned checkout'],
      cron: ['cron', 'cron_job', 'cron job'],
    };

    return (aliases[normalized] ?? [normalized]).includes(nodeTrigger);
  }

  private isTerminalNode(node: AutomationNode): boolean {
    return !TRIGGER_NODE_TYPES.has(node.type) && node.type !== AutomationNodeType.WAIT;
  }

  private findUnreachableNodeIds(
    startNodeId: number,
    nodeIds: Set<number>,
    outgoing: Map<number, AutomationConnection[]>,
  ): number[] {
    const visited = new Set<number>();
    const queue = [startNodeId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current == null || visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const connection of outgoing.get(current) ?? []) {
        if (!visited.has(connection.targetNodeId)) {
          queue.push(connection.targetNodeId);
        }
      }
    }

    return [...nodeIds].filter((id) => !visited.has(id));
  }

  private hasCycle(
    startNodeId: number,
    outgoing: Map<number, AutomationConnection[]>,
  ): boolean {
    const visiting = new Set<number>();
    const visited = new Set<number>();

    const dfs = (nodeId: number): boolean => {
      if (visiting.has(nodeId)) {
        return true;
      }
      if (visited.has(nodeId)) {
        return false;
      }
      visiting.add(nodeId);
      for (const connection of outgoing.get(nodeId) ?? []) {
        if (dfs(connection.targetNodeId)) {
          return true;
        }
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };

    return dfs(startNodeId);
  }
}
