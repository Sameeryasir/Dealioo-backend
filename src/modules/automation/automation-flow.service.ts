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
  /** Optional wallet reminder email after pass-not-added filter. */
  walletEmailNode: AutomationNode | null;
  /** Optional wait between QR pass email and wallet filter/email. */
  waitBeforeWalletNode: AutomationNode | null;
  /** Optional pass-not-added filter before wallet reminder. */
  walletFilterNode: AutomationNode | null;
  /** Optional offer-expiry reminder email. */
  expiryEmailNode: AutomationNode | null;
  /** Optional wait before expiry filter/email. */
  waitBeforeExpiryNode: AutomationNode | null;
  /** Optional offer-expires-within filter before expiry email. */
  expiryFilterNode: AutomationNode | null;
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
    let walletEmailNode: AutomationNode | null = null;
    let waitBeforeWalletNode: AutomationNode | null = null;
    let walletFilterNode: AutomationNode | null = null;
    let expiryEmailNode: AutomationNode | null = null;
    let waitBeforeExpiryNode: AutomationNode | null = null;
    let expiryFilterNode: AutomationNode | null = null;
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
        if (conditionNode == null && this.conditionTargetsUnpaidCustomers(node.config ?? {})) {
          conditionNode = node;
        }
        if (this.conditionTargetsUnpaidCustomers(node.config ?? {})) {
          sendToUnpaidOnly = true;
        }
        if (
          walletFilterNode == null &&
          this.conditionTargetsPassNotAdded(node.config ?? {})
        ) {
          walletFilterNode = node;
        }
        if (
          expiryFilterNode == null &&
          this.conditionTargetsOfferExpiresWithin(node.config ?? {})
        ) {
          expiryFilterNode = node;
        }
      }
    }

    if (emailNodes.length > 0) {
      emailNode = emailNodes[0];
    }
    if (emailNodes.length > 1) {
      passEmailNode =
        emailNodes.find((node) => this.isQrPassEmailNode(node)) ??
        emailNodes[1];
      waitBeforePassNode =
        nodes.find(
          (node) =>
            node.type === AutomationNodeType.WAIT &&
            emailNode != null &&
            node.order > emailNode.order &&
            node.order < passEmailNode!.order,
        ) ??
        nodes.find(
          (node) =>
            node.type === AutomationNodeType.WAIT &&
            emailNode != null &&
            node.order > emailNode.order,
        ) ??
        null;
    }

    walletEmailNode =
      emailNodes.find((node) => this.isWalletReminderEmailNode(node)) ?? null;
    expiryEmailNode =
      emailNodes.find((node) => this.isExpiryReminderEmailNode(node)) ?? null;

    if (passEmailNode != null && walletEmailNode != null) {
      waitBeforeWalletNode =
        nodes.find(
          (node) =>
            node.type === AutomationNodeType.WAIT &&
            node.order > passEmailNode!.order &&
            node.order < walletEmailNode!.order,
        ) ?? null;
    }

    if (
      walletFilterNode == null &&
      passEmailNode != null &&
      walletEmailNode != null
    ) {
      walletFilterNode =
        nodes.find(
          (node) =>
            node.type === AutomationNodeType.CONDITION &&
            node.order > passEmailNode!.order &&
            node.order < walletEmailNode!.order &&
            this.conditionTargetsPassNotAdded(node.config ?? {}),
        ) ?? null;
    }

    if (walletEmailNode != null && expiryEmailNode != null) {
      waitBeforeExpiryNode =
        nodes.find(
          (node) =>
            node.type === AutomationNodeType.WAIT &&
            node.order > walletEmailNode!.order &&
            node.order < expiryEmailNode!.order,
        ) ?? null;
    }

    if (
      expiryFilterNode == null &&
      walletEmailNode != null &&
      expiryEmailNode != null
    ) {
      expiryFilterNode =
        nodes.find(
          (node) =>
            node.type === AutomationNodeType.CONDITION &&
            node.order > walletEmailNode!.order &&
            node.order < expiryEmailNode!.order &&
            this.conditionTargetsOfferExpiresWithin(node.config ?? {}),
        ) ?? null;
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
      walletEmailNode,
      waitBeforeWalletNode,
      walletFilterNode,
      expiryEmailNode,
      waitBeforeExpiryNode,
      expiryFilterNode,
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

  conditionTargetsPassNotAdded(config: Record<string, unknown>): boolean {
    const label = String(
      config.conditionType ?? config.type ?? config.label ?? '',
    ).toLowerCase();
    const raw = JSON.stringify(config.conditions ?? config.value ?? '').toLowerCase();
    return (
      label.includes('pass not added') ||
      raw.includes('pass was added') ||
      raw.includes('not pass was added') ||
      raw.includes('pass not added')
    );
  }

  conditionTargetsOfferExpiresWithin(config: Record<string, unknown>): boolean {
    const label = String(
      config.conditionType ?? config.type ?? config.label ?? '',
    ).toLowerCase();
    const raw = JSON.stringify(config.conditions ?? config.value ?? '').toLowerCase();
    return (
      label.includes('offer expires') ||
      raw.includes('offer expires in less than')
    );
  }

  parseOfferExpiresWithin(
    config: Record<string, unknown>,
  ): { amount: number; unit: string } | null {
    const conditions = Array.isArray(config.conditions) ? config.conditions : [];
    const first =
      conditions[0] && typeof conditions[0] === 'object'
        ? (conditions[0] as Record<string, unknown>)
        : null;
    if (first) {
      const amount = Number(first.amount);
      const unit = String(first.unit ?? 'days').trim() || 'days';
      if (Number.isFinite(amount) && amount > 0) {
        return { amount: Math.floor(amount), unit };
      }
      const fromValue = this.parseOfferExpiresWithinLabel(String(first.value ?? ''));
      if (fromValue) {
        return fromValue;
      }
    }
    return this.parseOfferExpiresWithinLabel(
      String(config.value ?? config.conditionType ?? ''),
    );
  }

  private parseOfferExpiresWithinLabel(
    label: string,
  ): { amount: number; unit: string } | null {
    const match = label
      .toLowerCase()
      .match(
        /offer expires in less than\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)/i,
      );
    if (!match) {
      return null;
    }
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }
    return { amount: Math.floor(amount), unit: match[2] };
  }

  private isWalletReminderEmailNode(node: AutomationNode): boolean {
    const config = node.config ?? {};
    const kind = String(config.workflowKind ?? '').toLowerCase();
    const message = String(config.message ?? '').toLowerCase();
    const headline = String(config.headline ?? '').toLowerCase();
    const subject = String(config.subject ?? '').toLowerCase();
    return (
      kind.includes('wallet') ||
      message.includes("haven't added your coupon") ||
      message.includes('havent added your coupon') ||
      headline.includes('add your coupon to google wallet') ||
      subject.includes('add your coupon to google wallet')
    );
  }

  private isExpiryReminderEmailNode(node: AutomationNode): boolean {
    const config = node.config ?? {};
    const kind = String(config.workflowKind ?? '').toLowerCase();
    const message = String(config.message ?? '').toLowerCase();
    const headline = String(config.headline ?? '').toLowerCase();
    const subject = String(config.subject ?? '').toLowerCase();
    return (
      kind.includes('expiry') ||
      message.includes('expiring soon') ||
      headline.includes('expiring soon') ||
      subject.includes('expiring soon')
    );
  }

  private isQrPassEmailNode(node: AutomationNode): boolean {
    if (
      this.isWalletReminderEmailNode(node) ||
      this.isExpiryReminderEmailNode(node)
    ) {
      return false;
    }
    const config = node.config ?? {};
    const template = String(config.template ?? '').toLowerCase();
    const subject = String(config.subject ?? '').toLowerCase();
    const headline = String(config.headline ?? '').toLowerCase();
    return (
      template.includes('qr pass') ||
      subject.includes('qr pass') ||
      headline.includes('qr pass is ready')
    );
  }
}
