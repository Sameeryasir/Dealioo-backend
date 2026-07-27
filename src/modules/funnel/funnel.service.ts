import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelVersion } from '../../db/entities/funnel-version.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { isBusinessOwnerScopedUser } from '../../utils/business-access';
import { BusinessHistoryService } from '../business-history/business-history.service';
import { RedemptionService } from '../redemption/redemption.service';
import { CreateFunnelDto } from './funnelDto/create-funnel.dto';
import { BusinessFunnelSummary } from './funnelDto/business-funnel-summary.dto';
import { UpdateFunnelDto } from './funnelDto/update-funnel.dto';

@Injectable()
export class FunnelService {
  constructor(
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(FunnelVersion)
    private readonly funnelVersionRepository: Repository<FunnelVersion>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly redemptionService: RedemptionService,
    private readonly businessHistoryService: BusinessHistoryService,
  ) {}

  async createOrUpdateFunnel(
    dto: CreateFunnelDto,
    user: User,
  ): Promise<Funnel> {
    requireAdminRole(
      user,
      'You do not have permission to manage funnels.',
    );

    const campaign = await this.campaignRepository.findOne({
      where: { id: dto.campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    let funnel = await this.funnelRepository.findOne({
      where: {
        campaignId: dto.campaignId,
      },
    });

    if (!funnel) {
      funnel = this.funnelRepository.create({
        campaign,
        campaignId: campaign.id,
        pages: dto.pages ?? {},
        published: false,
        updatedBy: { id: user.id } as User,
      });

      const saved = await this.funnelRepository.save(funnel);
      await this.appendFunnelVersion({
        funnelId: saved.id,
        businessId: campaign.businessId,
        schema: saved.pages ?? {},
        versionNumber: 1,
        createdById: user.id,
      });
      return saved;
    }

    funnel.pages = dto.pages ?? funnel.pages;
    funnel.updatedBy = { id: user.id } as User;

    const saved = await this.funnelRepository.save(funnel);
    const nextVersion = (await this.getLatestVersionNumber(saved.id)) + 1;
    await this.appendFunnelVersion({
      funnelId: saved.id,
      businessId: campaign.businessId,
      schema: saved.pages ?? {},
      versionNumber: nextVersion,
      createdById: user.id,
    });

    await this.businessHistoryService.logFunnelUpdated({
      businessId: campaign.businessId,
      funnelId: saved.id,
      funnelName: campaign.campaignName,
      actorUserId: user.id,
    });

    return saved;
  }

  async getFunnelById(id: number): Promise<Funnel> {
    const funnel = await this.funnelRepository.findOne({
      where: { id },
      relations: ['campaign', 'updatedBy'],
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }
    return funnel;
  }

  async getFunnelsByBusinessId(
    businessId: number,
  ): Promise<BusinessFunnelSummary[]> {
    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const funnels = await this.funnelRepository.find({
      where: {
        campaign: { businessId },
      },
      relations: ['campaign'],
      select: {
        id: true,
        campaign: {
          campaignName: true,
          price: true,
        },
      },
      order: { createdAt: 'DESC' },
    });

    return funnels.map((funnel) => ({
      id: funnel.id,
      campaignName: funnel.campaign.campaignName,
      price:
        funnel.campaign.price != null ? Number(funnel.campaign.price) : null,
    }));
  }

  async getFunnelMetaByCampaignId(
    campaignId: number,
    user: Pick<User, 'id'> & { role: { name: string } },
  ): Promise<{ id: number; version: number } | null> {
    const qb = this.funnelRepository
      .createQueryBuilder('funnel')
      .select(['funnel.id'])
      .where('funnel.campaignId = :campaignId', { campaignId });

    if (isBusinessOwnerScopedUser(user)) {
      qb.innerJoin('funnel.campaign', 'campaign')
        .innerJoin('campaign.business', 'business')
        .andWhere('business.owner_id = :userId', { userId: user.id });
    }

    const funnel = await qb.getOne();
    if (!funnel) {
      return null;
    }

    const version = await this.getLatestVersionNumber(funnel.id);
    return { id: funnel.id, version };
  }

  async getFunnelByCampaignId(
    campaignId: number,
    user: Pick<User, 'id'> & { role: { name: string } },
  ): Promise<Funnel | null> {
    const meta = await this.getFunnelMetaByCampaignId(campaignId, user);
    if (!meta) {
      return null;
    }

    return this.getFunnelBodyByCampaignId(campaignId);
  }

  getFunnelBodyByCampaignId(campaignId: number): Promise<Funnel | null> {
    return this.funnelRepository.findOne({
      where: { campaignId },
    });
  }

  async getFunnelSummaryByCampaignId(
    campaignId: number,
    user: Pick<User, 'id'> & { role: { name: string } },
  ): Promise<{ id: number } | null> {
    const qb = this.funnelRepository
      .createQueryBuilder('funnel')
      .select(['funnel.id'])
      .where('funnel.campaignId = :campaignId', { campaignId });

    if (isBusinessOwnerScopedUser(user)) {
      qb.innerJoin('funnel.campaign', 'campaign')
        .innerJoin('campaign.business', 'business')
        .andWhere('business.owner_id = :userId', { userId: user.id });
    }

    const funnel = await qb.getOne();
    return funnel ? { id: funnel.id } : null;
  }

  async updateFunnel(
    id: number,
    dto: UpdateFunnelDto,
    user: User,
  ): Promise<Funnel> {
    requireAdminRole(
      user,
      'You do not have permission to update a funnel.',
    );

    const funnel = await this.funnelRepository.findOne({
      where: { id },
      relations: ['campaign', 'updatedBy'],
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    const currentVersion = await this.getLatestVersionNumber(funnel.id);
    if (dto.expectedVersion !== currentVersion) {
      throw new ConflictException(
        'This funnel was changed elsewhere. Reload the latest version and try again.',
      );
    }

    if (dto.pages !== undefined) {
      funnel.pages = dto.pages;
    }
    if (dto.published !== undefined) {
      funnel.published = dto.published;
    }
    funnel.updatedBy = { id: user.id } as User;

    const saved = await this.funnelRepository.save(funnel);
    await this.appendFunnelVersion({
      funnelId: saved.id,
      businessId: funnel.campaign.businessId,
      schema: saved.pages ?? {},
      versionNumber: currentVersion + 1,
      createdById: user.id,
    });

    await this.businessHistoryService.logFunnelUpdated({
      businessId: funnel.campaign.businessId,
      funnelId: saved.id,
      funnelName: funnel.campaign.campaignName,
      actorUserId: user.id,
    });

    return saved;
  }

  async deleteFunnel(id: number, user: User): Promise<void> {
    requireAdminRole(
      user,
      'You do not have permission to delete a funnel.',
    );

    const funnel = await this.funnelRepository.findOne({
      where: { id },
      relations: ['campaign'],
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    await this.businessHistoryService.logFunnelDeleted({
      businessId: funnel.campaign.businessId,
      funnelId: funnel.id,
      funnelName: funnel.campaign.campaignName,
      actorUserId: user.id,
    });

    await this.funnelRepository.delete({ id });
  }

  private async getLatestVersionNumber(funnelId: number): Promise<number> {
    const result = await this.funnelVersionRepository
      .createQueryBuilder('version')
      .select('MAX(version.versionNumber)', 'max')
      .where('version.funnelId = :funnelId', { funnelId })
      .getRawOne<{ max: string | null }>();

    const max = result?.max != null ? Number(result.max) : 0;
    return Number.isFinite(max) ? max : 0;
  }

  private async appendFunnelVersion(input: {
    funnelId: number;
    businessId: number | null;
    schema: Record<string, unknown>;
    versionNumber: number;
    createdById?: number | null;
    operationId?: string | null;
  }): Promise<FunnelVersion> {
    const row = this.funnelVersionRepository.create({
      funnelId: input.funnelId,
      businessId: input.businessId,
      versionNumber: input.versionNumber,
      schema: structuredClone(input.schema),
      operationId: input.operationId ?? null,
      createdById: input.createdById ?? null,
    });
    return this.funnelVersionRepository.save(row);
  }
}
