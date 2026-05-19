import {
  BadRequestException,
  ConflictException,
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
import {
  AutomationExecution,
  AutomationExecutionStatus,
} from '../../db/entities/automation-execution.entity';
import { AutomationLog } from '../../db/entities/automation-log.entity';
import { AutomationNode } from '../../db/entities/automation-node.entity';
import { Campaign } from '../../db/entities/campaign.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationEngineService } from './automation-engine.service';
import { AutomationLogService } from './automation-log.service';
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
    private readonly executionService: AutomationExecutionService,
    private readonly engineService: AutomationEngineService,
    private readonly logService: AutomationLogService,
    private readonly workerService: AutomationWorkerService,
  ) {}

  async createAutomation(
    dto: CreateAutomationDto,
    user: User,
  ): Promise<Automation> {
    requireAdminRole(user, 'You do not have permission to create automations.');

    const { restaurantId, campaignId, funnelId } =
      await this.resolveScopeIds(dto);

    const automation = this.automationRepository.create({
      restaurantId,
      name: dto.name,
      description: dto.description?.trim() ?? null,
      trigger: dto.trigger,
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
      automation.campaignId = dto.campaignId;
    }
    if (dto.funnelId !== undefined) {
      automation.funnelId = dto.funnelId;
    }

    if (dto.campaignId !== undefined || dto.funnelId !== undefined) {
      await this.validateScope(
        automation.restaurantId,
        automation.campaignId,
        automation.funnelId,
      );
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
    return this.executionService.findExecutions(filters);
  }

  async getExecutionById(id: number): Promise<AutomationExecution> {
    return this.executionService.findById(id);
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

    const hasActive = await this.executionService.hasActiveExecution(
      dto.automationId,
      dto.customerId,
    );
    if (hasActive) {
      throw new ConflictException(
        'Customer already has an active execution for this automation',
      );
    }

    const startNodeId =
      dto.currentNodeId ??
      (await this.executionService.resolveStartNodeId(dto.automationId));

    if (!startNodeId) {
      throw new BadRequestException(
        'Automation has no start node. Add a trigger node first.',
      );
    }

    const execution = await this.executionService.createExecution({
      automationId: dto.automationId,
      customerId: dto.customerId,
      currentNodeId: startNodeId,
    });

    this.workerService.enqueue(() =>
      this.engineService.processExecution(execution.id),
    );

    return execution;
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

      const execution = await this.executionService.createExecution({
        automationId: automation.id,
        customerId: event.customerId,
        currentNodeId: startNodeId,
      });

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

  private async resolveScopeIds(dto: CreateAutomationDto): Promise<{
    restaurantId: number;
    campaignId: number | null;
    funnelId: number | null;
  }> {
    let funnelId = dto.funnelId ?? null;
    let campaignId = dto.campaignId ?? null;
    let restaurantId = dto.restaurantId ?? null;

    if (funnelId) {
      const funnel = await this.funnelRepository.findOne({
        where: { id: funnelId },
        relations: ['campaign'],
      });
      if (!funnel) {
        throw new NotFoundException('Funnel not found');
      }
      campaignId = funnel.campaignId;
      restaurantId = funnel.campaign.restaurantId;
    } else if (campaignId) {
      const campaign = await this.campaignRepository.findOne({
        where: { id: campaignId },
      });
      if (!campaign) {
        throw new NotFoundException('Campaign not found');
      }
      restaurantId = campaign.restaurantId;
    }

    if (!restaurantId) {
      throw new BadRequestException(
        'restaurantId is required when campaignId and funnelId are omitted',
      );
    }

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    await this.validateScope(restaurantId, campaignId, funnelId);

    return { restaurantId, campaignId, funnelId };
  }

  private async validateScope(
    restaurantId: number,
    campaignId: number | null,
    funnelId: number | null,
  ): Promise<void> {
    if (campaignId) {
      const campaign = await this.campaignRepository.findOne({
        where: { id: campaignId },
      });
      if (!campaign) {
        throw new NotFoundException('Campaign not found');
      }
      if (campaign.restaurantId !== restaurantId) {
        throw new BadRequestException(
          'Campaign does not belong to this restaurant',
        );
      }
    }

    if (funnelId) {
      const funnel = await this.funnelRepository.findOne({
        where: { id: funnelId },
        relations: ['campaign'],
      });
      if (!funnel) {
        throw new NotFoundException('Funnel not found');
      }
      if (funnel.campaign.restaurantId !== restaurantId) {
        throw new BadRequestException(
          'Funnel does not belong to this restaurant',
        );
      }
      if (campaignId && funnel.campaignId !== campaignId) {
        throw new BadRequestException(
          'Funnel does not belong to this campaign',
        );
      }
    }
  }
}
