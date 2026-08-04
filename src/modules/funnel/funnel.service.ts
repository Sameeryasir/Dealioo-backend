import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign, CampaignType } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelVersion } from '../../db/entities/funnel-version.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import {
  FunnelPageType,
  FUNNEL_PAGE_TYPES,
  FUNNEL_PAGE_TYPES_WITHOUT_PAYMENT,
  isFunnelPageType,
} from '../../db/entities/funnel-page-type';
import { requireAdminRole } from '../../utils/require-admin-role';
import { isBusinessOwnerScopedUser } from '../../utils/business-access';
import { BusinessHistoryService } from '../business-history/business-history.service';
import { BusinessTrackingService } from '../business-tracking/business-tracking.service';
import { FunnelPagesService } from '../funnel-pages/funnel-pages.service';
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
    private readonly businessTrackingService: BusinessTrackingService,
    private readonly funnelPagesService: FunnelPagesService,
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

    const isPostpaid = campaign.campaignType === CampaignType.POSTPAID;
    const ensurePageTypes = isPostpaid
      ? FUNNEL_PAGE_TYPES_WITHOUT_PAYMENT
      : FUNNEL_PAGE_TYPES;
    const removePageTypes = isPostpaid
      ? ([FunnelPageType.PAYMENT] as const)
      : undefined;

    const stripPaymentPage = (
      pages: Record<string, unknown>,
    ): Record<string, unknown> => {
      if (!isPostpaid || !('payment' in pages)) return pages;
      const { payment: _payment, ...rest } = pages;
      return rest;
    };

    if (!funnel) {
      funnel = this.funnelRepository.create({
        campaign,
        campaignId: campaign.id,
        businessId: campaign.businessId,
        published: false,
        contentRevision: 0,
        updatedBy: { id: user.id } as User,
      });

      const saved = await this.funnelRepository.save(funnel);
      const defaultPages = isPostpaid
        ? {
            landing: {},
            signup: {},
            confirmation: {},
          }
        : {
            landing: {},
            signup: {},
            payment: {},
            confirmation: {},
          };
      const { assembledPages } = await this.funnelPagesService.syncPages({
        funnelId: saved.id,
        businessId: campaign.businessId,
        pages: stripPaymentPage(dto.pages ?? defaultPages),
        createdById: user.id,
        bumpRevision: true,
        ensurePageTypes,
        removePageTypes,
      });
      await this.appendFunnelVersion({
        funnelId: saved.id,
        businessId: campaign.businessId,
        schema: assembledPages,
        versionNumber: 1,
        createdById: user.id,
      });
      return this.getFunnelById(saved.id);
    }

    funnel.businessId = campaign.businessId;
    funnel.updatedBy = { id: user.id } as User;

    const saved = await this.funnelRepository.save(funnel);
    const pagesPayload = stripPaymentPage(
      dto.pages ??
        (await this.funnelPagesService.loadAssembledPages(saved.id)),
    );
    const { assembledPages, changedTypes } =
      await this.funnelPagesService.syncPages({
        funnelId: saved.id,
        businessId: campaign.businessId,
        pages: pagesPayload,
        createdById: user.id,
        bumpRevision: true,
        ensurePageTypes,
        removePageTypes,
      });

    const latest = await this.getFunnelById(saved.id);
    if (changedTypes.length > 0) {
      await this.appendFunnelVersion({
        funnelId: latest.id,
        businessId: campaign.businessId,
        schema: assembledPages,
        versionNumber: latest.contentRevision,
        createdById: user.id,
      });
    }

    await this.businessHistoryService.logFunnelUpdated({
      businessId: campaign.businessId,
      funnelId: latest.id,
      funnelName: campaign.campaignName,
      actorUserId: user.id,
    });

    return latest;
  }

  async getFunnelById(id: number): Promise<Funnel> {
    const funnel = await this.funnelRepository.findOne({
      where: { id },
      relations: ['campaign', 'updatedBy'],
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }
    const pages = await this.funnelPagesService.loadAssembledPages(funnel.id);
    if (funnel.campaign?.campaignType === CampaignType.POSTPAID) {
      const { payment: _payment, ...rest } = pages;
      funnel.pages = rest;
    } else {
      funnel.pages = pages;
    }
    return funnel;
  }

  private publicPagesForStep(step?: string | null): FunnelPageType[] {
    const normalized = step?.trim().toLowerCase() ?? '';
    if (normalized && isFunnelPageType(normalized)) {
      return [normalized];
    }
    return [FunnelPageType.LANDING];
  }

  async getPublicFunnelById(
    id: number,
    trackingBusinessId?: number | null,
    step?: string | null,
  ): Promise<{
    id: number;
    campaignId: number;
    businessId: number | null;
    pixelId: string | null;
    googleTagManagerId: string | null;
    step: string;
    pages: Record<string, unknown>;
  }> {
    const funnel = await this.funnelRepository.findOne({
      where: { id },
      select: {
        id: true,
        campaignId: true,
        businessId: true,
      },
    });
    if (!funnel) {
      throw new NotFoundException('Funnel not found');
    }

    let businessId =
      trackingBusinessId && trackingBusinessId > 0
        ? trackingBusinessId
        : funnel.businessId;

    if (businessId == null) {
      const campaign = await this.campaignRepository.findOne({
        where: { id: funnel.campaignId },
        select: { id: true, businessId: true },
      });
      businessId = campaign?.businessId ?? null;
    }

    const tracking =
      businessId != null
        ? await this.businessTrackingService.getActivePublicIdsForBusiness(
            businessId,
          )
        : { pixelId: null, googleTagManagerId: null };

    const pageTypes = this.publicPagesForStep(step);
    const resolvedStep = pageTypes[0] ?? FunnelPageType.LANDING;

    const pages = await this.funnelPagesService.loadSubsetPages(
      funnel.id,
      pageTypes,
    );

    return {
      id: funnel.id,
      campaignId: funnel.campaignId,
      businessId,
      pixelId: tracking.pixelId,
      googleTagManagerId: tracking.googleTagManagerId,
      step: resolvedStep,
      pages,
    };
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
      .select(['funnel.id', 'funnel.contentRevision'])
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

    const version =
      funnel.contentRevision > 0
        ? funnel.contentRevision
        : await this.getLatestLegacyVersionNumber(funnel.id);
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

  async getFunnelBodyByCampaignId(campaignId: number): Promise<Funnel | null> {
    const funnel = await this.funnelRepository.findOne({
      where: { campaignId },
    });
    if (!funnel) {
      return null;
    }
    funnel.pages = await this.funnelPagesService.loadAssembledPages(funnel.id);
    return funnel;
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

    const currentVersion =
      funnel.contentRevision > 0
        ? funnel.contentRevision
        : await this.getLatestLegacyVersionNumber(funnel.id);
    if (dto.expectedVersion !== currentVersion) {
      throw new ConflictException(
        'This funnel was changed elsewhere. Reload the latest version and try again.',
      );
    }

    if (dto.published !== undefined) {
      funnel.published = dto.published;
    }
    funnel.updatedBy = { id: user.id } as User;
    funnel.businessId = funnel.campaign.businessId;

    const saved = await this.funnelRepository.save(funnel);
    const isPostpaid = funnel.campaign.campaignType === CampaignType.POSTPAID;

    if (dto.pages !== undefined) {
      const pages = isPostpaid
        ? (() => {
            const { payment: _payment, ...rest } = dto.pages as Record<
              string,
              unknown
            >;
            return rest;
          })()
        : dto.pages;
      const { assembledPages, changedTypes } =
        await this.funnelPagesService.syncPages({
          funnelId: saved.id,
          businessId: funnel.campaign.businessId,
          pages,
          createdById: user.id,
          bumpRevision: true,
          ensurePageTypes: isPostpaid
            ? FUNNEL_PAGE_TYPES_WITHOUT_PAYMENT
            : FUNNEL_PAGE_TYPES,
          removePageTypes: isPostpaid
            ? ([FunnelPageType.PAYMENT] as const)
            : undefined,
        });
      if (changedTypes.length > 0) {
        const latest = await this.funnelRepository.findOne({
          where: { id: saved.id },
        });
        await this.appendFunnelVersion({
          funnelId: saved.id,
          businessId: funnel.campaign.businessId,
          schema: assembledPages,
          versionNumber: latest?.contentRevision ?? currentVersion + 1,
          createdById: user.id,
        });
      }
    } else {
      saved.contentRevision = currentVersion + 1;
      await this.funnelRepository.save(saved);
    }

    await this.businessHistoryService.logFunnelUpdated({
      businessId: funnel.campaign.businessId,
      funnelId: saved.id,
      funnelName: funnel.campaign.campaignName,
      actorUserId: user.id,
    });

    return this.getFunnelById(saved.id);
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

  private async getLatestLegacyVersionNumber(funnelId: number): Promise<number> {
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
