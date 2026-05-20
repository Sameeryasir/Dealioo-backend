import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Automation,
  AutomationTrigger,
} from '../../db/entities/automation.entity';
import { AutomationConnection } from '../../db/entities/automation-connection.entity';
import { AutomationPurpose } from '../../db/entities/automation-purpose.enum';
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import {
  AutomationNode,
  AutomationNodeType,
} from '../../db/entities/automation-node.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { Customer } from '../../db/entities/customer.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationLogService } from './automation-log.service';
import { AutomationEmailRendererService } from './automation-email-renderer.service';
import { AutomationMailService } from './automation-mail.service';
import { resolveAutomationEmailTemplateFromPurpose } from '../../templates/automation/registry';
import type { AutomationEmailTemplateProps } from '../../templates/automation/types';
import { AutomationFlowService } from './automation-flow.service';
import { AutomationWorkerService } from './automation-worker.service';
import { StartAutomationExecutionDto } from './automationDto/start-automation-execution.dto';
import { CreateAutomationConnectionDto } from './automationDto/create-automation-connection.dto';
import { CreateAutomationDto } from './automationDto/create-automation.dto';
import { CreateAutomationNodeDto } from './automationDto/create-automation-node.dto';
import { UpdateAutomationDto } from './automationDto/update-automation.dto';
import { UpdateAutomationNodeDto } from './automationDto/update-automation-node.dto';

@Injectable()
export class AutomationService {
  constructor(
    @InjectRepository(Automation)
    private readonly automationRepository: Repository<Automation>,
    @InjectRepository(AutomationNode)
    private readonly nodeRepository: Repository<AutomationNode>,
    @InjectRepository(AutomationConnection)
    private readonly connectionRepository: Repository<AutomationConnection>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(FunnelPayment)
    private readonly funnelPaymentRepository: Repository<FunnelPayment>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly executionService: AutomationExecutionService,
    private readonly engineService: AutomationEngineService,
    private readonly logService: AutomationLogService,
    private readonly mailService: AutomationMailService,
    private readonly emailRenderer: AutomationEmailRendererService,
    private readonly flowService: AutomationFlowService,
    private readonly workerService: AutomationWorkerService,
  ) {}

  async createAutomation(
    dto: CreateAutomationDto,
    user: User,
  ): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to create automations.');

    const { restaurantId, campaignId, funnelId } =
      await this.resolveScopeFromCampaign(dto.campaignId, dto.restaurantId);

    this.validatePurposeAndTrigger(dto.purpose, dto.trigger);

    const automation = this.automationRepository.create({
      restaurantId,
      name: dto.name,
      description: dto.description?.trim() ?? null,
      trigger: dto.trigger,
      purpose: dto.purpose,
      campaignId,
      funnelId,
      createdBy: user.id,
      isActive: dto.isActive ?? true,
      published: false,
      isTemplate: false,
    });

    return this.automationRepository.save(automation);
  }

  async updateAutomation(
    id: number,
    dto: UpdateAutomationDto,
    user: User,
  ): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to update automations.');

    const automation = await this.findAutomationById(id);

    if (dto.name !== undefined) {
      automation.name = dto.name;
    }
    if (dto.description !== undefined) {
      automation.description = dto.description?.trim() ?? null;
    }
    if (dto.trigger !== undefined) {
      automation.trigger = dto.trigger;
    }
    if (dto.purpose !== undefined) {
      automation.purpose = dto.purpose;
    }
    if (dto.trigger !== undefined || dto.purpose !== undefined) {
      this.validatePurposeAndTrigger(automation.purpose, automation.trigger);
    }
    if (dto.isActive !== undefined) {
      automation.isActive = dto.isActive;
    }
    if (dto.published !== undefined) {
      automation.published = dto.published;
    }
    if (dto.isTemplate !== undefined) {
      automation.isTemplate = dto.isTemplate;
    }
    if (dto.campaignId !== undefined) {
      const scope = await this.resolveScopeFromCampaign(
        dto.campaignId,
        dto.restaurantId,
      );
      automation.restaurantId = scope.restaurantId;
      automation.campaignId = scope.campaignId;
      automation.funnelId = scope.funnelId;
    }

    return this.automationRepository.save(automation);
  }

  async getAutomations(restaurantId?: number): Promise<Automation[]> {
    if (restaurantId) {
      const restaurant = await this.restaurantRepository.findOne({
        where: { id: restaurantId },
      });
      if (!restaurant) {
        throw new NotFoundException('Restaurant not found');
      }
      return this.automationRepository.find({
        where: { restaurantId },
        order: { createdAt: 'DESC' },
      });
    }

    return this.automationRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findAutomationById(id: number): Promise<Automation> {
    const automation = await this.automationRepository.findOne({
      where: { id },
      relations: ['nodes', 'connections'],
    });
    if (!automation) {
      throw new NotFoundException('Automation not found');
    }
    return automation;
  }

  async deleteAutomation(id: number, user: User): Promise<void> {
    requireAdminRole(user, 'You do not have permission to delete automations.');
    const automation = await this.findAutomationById(id);
    await this.automationRepository.remove(automation);
  }

  async publishAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to publish automations.');
    const automation = await this.findAutomationById(id);
    automation.published = true;
    return this.automationRepository.save(automation);
  }

  async activateAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to activate automations.');
    const automation = await this.findAutomationById(id);
    automation.isActive = true;
    return this.automationRepository.save(automation);
  }

  async deactivateAutomation(id: number, user: User): Promise<Automation> {
    requireAdminRole(
      user,
      'You do not have permission to deactivate automations.',
    );
    const automation = await this.findAutomationById(id);
    automation.isActive = false;
    return this.automationRepository.save(automation);
  }

  async createNode(dto: CreateAutomationNodeDto): Promise<AutomationNode> {
    await this.findAutomationById(dto.automationId);

    const node = this.nodeRepository.create({
      automationId: dto.automationId,
      type: dto.type,
      config: dto.config ?? {},
      positionX: dto.positionX ?? 0,
      positionY: dto.positionY ?? 0,
      order: dto.order,
    });

    return this.nodeRepository.save(node);
  }

  async getNodesByFunnelId(funnelId: number): Promise<{
    funnelId: number;
    automationIds: number[];
    nodes: AutomationNode[];
    connections: AutomationConnection[];
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id: funnelId },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const automations = await this.automationRepository.find({
      where: { funnelId },
      select: ['id'],
    });

    if (automations.length === 0) {
      return { funnelId, automationIds: [], nodes: [], connections: [] };
    }

    const automationIds = automations.map((automation) => automation.id);

    const nodes = await this.nodeRepository.find({
      where: { automationId: In(automationIds) },
      order: { order: 'ASC', id: 'ASC' },
    });

    const connections = await this.connectionRepository.find({
      where: { automationId: In(automationIds) },
    });

    return { funnelId, automationIds, nodes, connections };
  }

  async updateNode(
    id: number,
    dto: UpdateAutomationNodeDto,
  ): Promise<AutomationNode> {
    const node = await this.nodeRepository.findOne({ where: { id } });
    if (!node) {
      throw new NotFoundException('Automation node not found');
    }

    if (dto.type !== undefined) {
      node.type = dto.type;
    }
    if (dto.config !== undefined) {
      node.config = dto.config;
    }
    if (dto.positionX !== undefined) {
      node.positionX = dto.positionX;
    }
    if (dto.positionY !== undefined) {
      node.positionY = dto.positionY;
    }
    if (dto.order !== undefined) {
      node.order = dto.order;
    }

    return this.nodeRepository.save(node);
  }

  async deleteNode(id: number): Promise<void> {
    const node = await this.nodeRepository.findOne({ where: { id } });
    if (!node) {
      throw new NotFoundException('Automation node not found');
    }
    await this.nodeRepository.remove(node);
  }

  async createConnection(
    dto: CreateAutomationConnectionDto,
  ): Promise<AutomationConnection> {
    await this.findAutomationById(dto.automationId);

    const source = await this.nodeRepository.findOne({
      where: { id: dto.sourceNodeId, automationId: dto.automationId },
    });
    const target = await this.nodeRepository.findOne({
      where: { id: dto.targetNodeId, automationId: dto.automationId },
    });

    if (!source || !target) {
      throw new BadRequestException(
        'Source and target nodes must belong to this automation',
      );
    }

    const connection = this.connectionRepository.create({
      automationId: dto.automationId,
      sourceNodeId: dto.sourceNodeId,
      targetNodeId: dto.targetNodeId,
    });

    return this.connectionRepository.save(connection);
  }

  async deleteConnection(id: number): Promise<void> {
    const connection = await this.connectionRepository.findOne({
      where: { id },
    });
    if (!connection) {
      throw new NotFoundException('Automation connection not found');
    }
    await this.connectionRepository.remove(connection);
  }

  async getExecutions(filters: {
    automationId?: number;
    customerId?: number;
    status?: AutomationExecutionStatus;
  }): Promise<AutomationExecution[]> {
    const executions = await this.executionService.findExecutions(filters);
    return this.attachExecutedRecipients(executions);
  }

  async getExecutionById(id: number): Promise<AutomationExecution> {
    const execution = await this.executionService.findById(id);
    const [enriched] = await this.attachExecutedRecipients([execution]);
    return enriched;
  }

  private async attachExecutedRecipients(
    executions: AutomationExecution[],
  ): Promise<AutomationExecution[]> {
    if (executions.length === 0) {
      return executions;
    }

    const recipientMap = await this.logService.findEmailRecipientsByExecutionIds(
      executions.map((execution) => execution.id),
    );

    return executions.map((execution) =>
      Object.assign(execution, {
        executedRecipients: recipientMap.get(execution.id) ?? [],
      }),
    );
  }

  async getExecutionLogs(executionId: number): Promise<AutomationLog[]> {
    await this.executionService.findById(executionId);
    return this.logService.findByExecutionId(executionId);
  }

  async getAutomationLogs(automationId: number): Promise<AutomationLog[]> {
    await this.findAutomationById(automationId);
    return this.logService.findByAutomationId(automationId);
  }

  async startExecution(
    dto: StartAutomationExecutionDto,
    user: User,
  ): Promise<AutomationExecution> {
    requireAdminRole(
      user,
      'You do not have permission to start automation executions.',
    );

    const automation = await this.findAutomationById(dto.automationId);

    if (!automation.isActive) {
      throw new BadRequestException('Automation is not active');
    }

    if (!automation.funnelId) {
      throw new BadRequestException('Automation has no funnel linked');
    }

    const plan = await this.flowService.buildExecutionPlan(dto.automationId);

    const { subject, templateKey, templateProps } = this.resolveEmailContent(
      plan.emailNode!,
      automation.purpose,
    );

    let recipients: { customerId: number; email: string; name: string }[] = [];
    if (plan.sendToUnpaidOnly) {
      recipients = await this.getUnpaidCustomersForFunnel(automation.funnelId);
      if (recipients.length === 0) {
        throw new BadRequestException(
          'No unpaid customers found for this funnel',
        );
      }
    } else {
      throw new BadRequestException(
        'Flow condition must target customers who have not completed payment.',
      );
    }

    const execution = await this.executionService.createExecution(
      {
        automationId: dto.automationId,
        currentNodeId: plan.startNodeId,
        purpose: automation.purpose,
      },
      recipients[0].customerId,
    );

    const batch = {
      executionId: execution.id,
      emailNodeId: plan.emailNode!.id,
      conditionNodeId: plan.conditionNode?.id ?? plan.emailNode!.id,
      subject,
      templateKey,
      templateProps,
      plan,
      recipients,
    };

    this.workerService.enqueue(() => this.processUnpaidReminderBatch(batch));

    return execution;
  }

  private async processUnpaidReminderBatch(batch: {
    executionId: number;
    emailNodeId: number;
    conditionNodeId: number;
    subject: string;
    templateKey: string;
    templateProps: Partial<AutomationEmailTemplateProps>;
    plan: {
      nodes: AutomationNode[];
      emailNode: AutomationNode | null;
      conditionNode: AutomationNode | null;
    };
    recipients: { customerId: number; email: string; name: string }[];
  }): Promise<void> {
    const sent: { customerId: number; email: string }[] = [];
    const pathSummary = batch.plan.nodes
      .map((node) => `order ${node.order}:${node.type}`)
      .join(' → ');
    const firstCustomerId = batch.recipients[0].customerId;

    await this.logService.createLog({
      executionId: batch.executionId,
      nodeId: batch.emailNodeId,
      customerId: firstCustomerId,
      message: `Step 0 email node: subject "${batch.subject}" loaded. Flow: ${pathSummary}`,
    });

    if (batch.plan.conditionNode) {
      const conditionLabel = String(
        batch.plan.conditionNode.config?.conditionType ??
          batch.plan.conditionNode.config?.type ??
          'condition',
      );
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.conditionNodeId,
        customerId: firstCustomerId,
        message: `Step 1 condition: "${conditionLabel}" — sending to ${batch.recipients.length} unpaid customer(s)`,
      });
    }

    for (const recipient of batch.recipients) {
      try {
        const { html, text } = await this.emailRenderer.render(
          batch.templateKey,
          {
            customerName: recipient.name,
            customerEmail: recipient.email,
            subject: batch.subject,
            ...batch.templateProps,
          },
        );
        await this.mailService.send({
          to: recipient.email,
          subject: batch.subject,
          html,
          text,
        });
        await this.executionService.updateCustomerId(
          batch.executionId,
          recipient.customerId,
        );
        await this.logService.createLog({
          executionId: batch.executionId,
          nodeId: batch.emailNodeId,
          customerId: recipient.customerId,
          message: `Payment reminder email sent to ${recipient.email}`,
        });
        sent.push(recipient);
      } catch {
        // Continue with the next unpaid customer.
      }
    }

    if (sent.length > 0) {
      const summary = sent
        .map((recipient) => `${recipient.email} (#${recipient.customerId})`)
        .join(', ');
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.plan.nodes[batch.plan.nodes.length - 1].id,
        customerId: sent[sent.length - 1].customerId,
        message: `Flow completed (node_order end). Emails sent to ${sent.length} customer(s): ${summary}`,
      });
    } else if (batch.recipients[0]) {
      await this.logService.createLog({
        executionId: batch.executionId,
        nodeId: batch.emailNodeId,
        customerId: batch.recipients[0].customerId,
        message: 'Workflow completed. No emails were sent.',
        error: 'All send attempts failed',
      });
    }

    await this.executionService.markCompleted(batch.executionId);
  }

  async executeAutomation(
    automationId: number,
    user: User,
  ): Promise<{ unpaidCount: number; emailsSent: number }> {
    requireAdminRole(
      user,
      'You do not have permission to execute automations.',
    );

    const automation = await this.findAutomationById(automationId);

    if (!automation.isActive) {
      throw new BadRequestException('Automation is not active');
    }

    if (
      automation.purpose !== AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER ||
      automation.trigger !== AutomationTrigger.SIGNUP
    ) {
      throw new BadRequestException(
        'Only signup payment-reminder automations can be run this way.',
      );
    }

    const execution = await this.startExecution({ automationId }, user);
    const logs = await this.logService.findByExecutionId(execution.id);
    const emailsSent = logs.filter((log) =>
      log.message.includes('email sent'),
    ).length;

    const unpaidRecipients = automation.funnelId
      ? await this.getUnpaidCustomersForFunnel(automation.funnelId)
      : [];

    return {
      unpaidCount: unpaidRecipients.length,
      emailsSent,
    };
  }

  private resolveEmailContent(
    emailNode: AutomationNode,
    purpose: AutomationPurpose,
  ): {
    subject: string;
    templateKey: string;
    templateProps: Partial<AutomationEmailTemplateProps>;
  } {
    const config = emailNode.config ?? {};
    const subject = String(config.subject ?? '').trim();
    if (!subject) {
      throw new BadRequestException(
        'Email node config must include subject.',
      );
    }

    const templateKey = resolveAutomationEmailTemplateFromPurpose(purpose);

    const templateProps: Partial<AutomationEmailTemplateProps> = {};
    if (config.message) {
      templateProps.message = String(config.message);
    }
    if (config.headline) {
      templateProps.headline = String(config.headline);
    }
    if (config.ctaLabel) {
      templateProps.ctaLabel = String(config.ctaLabel);
    }
    if (config.ctaUrl) {
      templateProps.ctaUrl = String(config.ctaUrl);
    }

    return { subject, templateKey, templateProps };
  }

  private async getUnpaidCustomersForFunnel(
    funnelId: number,
  ): Promise<{ customerId: number; email: string; name: string }[]> {
    const unpaidPayments = await this.funnelPaymentRepository.find({
      where: {
        funnelId,
        status: In([
          FunnelPaymentStatus.PENDING,
          FunnelPaymentStatus.FAILED,
          FunnelPaymentStatus.CANCELLED,
        ]),
      },
      select: ['customerEmail'],
    });

    const normalizedEmails = [
      ...new Set(
        unpaidPayments
          .map((payment) => payment.customerEmail?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email)),
      ),
    ];

    if (normalizedEmails.length === 0) {
      return [];
    }

    const customers = await this.customerRepository
      .createQueryBuilder('customer')
      .where('LOWER(customer.email) IN (:...emails)', {
        emails: normalizedEmails,
      })
      .getMany();

    const recipients: { customerId: number; email: string; name: string }[] =
      [];
    const seenCustomerIds = new Set<number>();

    for (const customer of customers) {
      if (seenCustomerIds.has(customer.id)) {
        continue;
      }
      seenCustomerIds.add(customer.id);
      recipients.push({
        customerId: customer.id,
        email: customer.email,
        name: customer.name,
      });
    }

    return recipients;
  }

  async processExecution(id: number, user: User): Promise<void> {
    requireAdminRole(
      user,
      'You do not have permission to process automation executions.',
    );
    await this.executionService.findById(id);
    this.workerService.enqueue(() => this.engineService.processExecution(id));
  }

  async resumeExecution(id: number, user: User): Promise<void> {
    requireAdminRole(
      user,
      'You do not have permission to resume automation executions.',
    );
    await this.executionService.findById(id);
    this.workerService.enqueue(() => this.engineService.resumeAfterWait(id));
  }

  async handleEvent(event: FunnelEvent): Promise<void> {
    if (!event.customerId) {
      return;
    }

    const trigger = this.mapFunnelEventToTrigger(event.eventType);
    if (!trigger) {
      return;
    }

    const funnel = await this.funnelRepository.findOne({
      where: { id: event.funnelId },
      relations: ['campaign'],
    });
    if (!funnel) {
      return;
    }

    const automations = await this.automationRepository.find({
      where: { trigger, isActive: true },
    });

    for (const automation of automations) {
      if (!this.matchesAutomationScope(automation, event, funnel)) {
        continue;
      }

      const hasActive = await this.executionService.hasActiveExecution(
        automation.id,
        event.customerId,
      );
      if (hasActive) {
        continue;
      }

      const startNodeId = await this.executionService.resolveStartNodeId(
        automation.id,
      );
      if (!startNodeId) {
        continue;
      }

      const execution = await this.executionService.createExecution(
        {
          automationId: automation.id,
          currentNodeId: startNodeId,
          purpose: automation.purpose,
        },
        event.customerId,
      );

      this.workerService.enqueue(() =>
        this.engineService.processExecution(execution.id),
      );
    }
  }

  private mapFunnelEventToTrigger(
    eventType: FunnelEventType,
  ): AutomationTrigger | null {
    if (eventType === FunnelEventType.SIGNUP) {
      return AutomationTrigger.SIGNUP;
    }
    if (eventType === FunnelEventType.PAYMENT) {
      return AutomationTrigger.PAYMENT;
    }
    return null;
  }

  private validatePurposeAndTrigger(
    purpose: AutomationPurpose,
    trigger: AutomationTrigger,
  ): void {
    const signupPurposes = new Set<AutomationPurpose>([
      AutomationPurpose.FUNNEL_SIGNUP,
      AutomationPurpose.FUNNEL_SIGNUP_PAYMENT_REMINDER,
    ]);

    if (
      signupPurposes.has(purpose) &&
      trigger !== AutomationTrigger.SIGNUP
    ) {
      throw new BadRequestException(
        'Signup payment reminder automations require trigger "signup".',
      );
    }

    if (
      purpose === AutomationPurpose.FUNNEL_PAYMENT &&
      trigger !== AutomationTrigger.PAYMENT
    ) {
      throw new BadRequestException(
        'Post-payment automations require trigger "payment".',
      );
    }

    if (
      purpose === AutomationPurpose.FUNNEL_ABANDONED_CHECKOUT_REMINDER &&
      trigger !== AutomationTrigger.ABANDONED_CHECKOUT
    ) {
      throw new BadRequestException(
        'Abandoned checkout automations require trigger "abandoned_checkout".',
      );
    }
  }

  private matchesAutomationScope(
    automation: Automation,
    event: FunnelEvent,
    funnel: Funnel,
  ): boolean {
    if (automation.funnelId && automation.funnelId !== event.funnelId) {
      return false;
    }

    if (automation.campaignId && automation.campaignId !== funnel.campaignId) {
      return false;
    }

    if (
      automation.restaurantId &&
      funnel.campaign?.restaurantId !== automation.restaurantId
    ) {
      return false;
    }

    return true;
  }

  private async resolveScopeFromCampaign(
    campaignId: number,
    restaurantId?: number,
  ): Promise<{
    restaurantId: number;
    campaignId: number;
    funnelId: number;
  }> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (restaurantId !== undefined && campaign.restaurantId !== restaurantId) {
      throw new BadRequestException(
        'Campaign does not belong to this restaurant',
      );
    }

    const funnel = await this.funnelRepository.findOne({
      where: { campaignId },
    });
    if (!funnel) {
      throw new BadRequestException(
        'No funnel exists for this campaign. Create a funnel for the campaign first.',
      );
    }

    return {
      restaurantId: campaign.restaurantId,
      campaignId: campaign.id,
      funnelId: funnel.id,
    };
  }
}
