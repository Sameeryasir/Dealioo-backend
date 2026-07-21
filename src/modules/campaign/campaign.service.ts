import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, IsNull, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import {
  Campaign,
  CampaignPublicationStatus,
} from '../../db/entities/campaign.entity';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { Coupon } from '../../db/entities/coupon.entity';
import { Customer } from '../../db/entities/customer.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import { RedemptionLog } from '../../db/entities/redemption-log.entity';
import { Business } from '../../db/entities/business.entity';
import {
  CAMPAIGNS_UPLOAD_SUBDIR,
  toAbsoluteAssetUrlIfRelative,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import { StripeCatalogService } from '../stripe/stripe-catalog.service';
import { BusinessAccessService } from '../business-access/business-access.service';
import { BusinessHistoryService } from '../business-history/business-history.service';
import { AutomationService } from '../automation/automation.service';
import { CreateCampaignDto } from './campaignDto/create-campaign.dto';
import { UpdateCampaignDto } from './campaignDto/update-campaign.dto';

type AuthUser = {
  id: number;
  email?: string;
  role?: { name: string } | null;
};

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    private readonly dataSource: DataSource,
    private readonly spacesService: SpacesService,
    private readonly stripeCatalogService: StripeCatalogService,
    private readonly businessAccessService: BusinessAccessService,
    private readonly automationService: AutomationService,
    private readonly businessHistoryService: BusinessHistoryService,
  ) {}

  async uploadCampaignImage(
    file?: Express.Multer.File,
  ): Promise<{ imageUrl: string }> {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    const imageUrl = await persistUploadedFile(
      this.spacesService,
      file,
      CAMPAIGNS_UPLOAD_SUBDIR,
      'absolute',
    );

    if (!imageUrl?.trim()) {
      throw new BadRequestException('Upload failed.');
    }

    return { imageUrl };
  }

  async createCampaign(
    createCampaignDto: CreateCampaignDto,
    user: AuthUser,
    file?: Express.Multer.File,
  ): Promise<Campaign> {
    const {
      businessId,
      campaignName,
      websiteUrl,
      imageUrl: dtoImageUrl,
      offer,
      price,
      status,
    } = createCampaignDto;

    await this.businessAccessService.assertPermission(
      user,
      businessId,
      'campaigns',
      'You do not have permission to create campaigns for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    if (!file && !dtoImageUrl?.trim()) {
      throw new BadRequestException('Campaign image is required.');
    }

    const imageUrl = file
      ? await persistUploadedFile(
          this.spacesService,
          file,
          CAMPAIGNS_UPLOAD_SUBDIR,
          'absolute',
        )
      : toAbsoluteAssetUrlIfRelative(dtoImageUrl);
    const campaign = this.campaignRepository.create({
      business,
      businessId: business.id,
      createdByUserId: user.id,
      campaignName,
      websiteUrl,
      imageUrl,
      offer: offer.trim(),
      price,
      status: status ?? CampaignPublicationStatus.PUBLISHED,
    });
    const savedCampaign = await this.campaignRepository.save(campaign);

    const funnel = this.funnelRepository.create({
      campaign: savedCampaign,
      campaignId: savedCampaign.id,
      pages: {},
      published: false,
      version: 1,
    });
    await this.funnelRepository.save(funnel);

    await this.stripeCatalogService.createCatalogForNewCampaign({
      campaign: savedCampaign,
      stripeAccountId: business.stripeAccountId,
    });

    await this.businessHistoryService.logCampaignCreated({
      businessId: savedCampaign.businessId,
      campaignId: savedCampaign.id,
      campaignName: savedCampaign.campaignName,
      actorUserId: user.id,
    });

    return savedCampaign;
  }

  async getAllCampaigns(): Promise<Campaign[]> {
    return this.campaignRepository.find();
  }

  async getCampaignsByBusinessId(
    businessId: number,
    user: AuthUser,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ data: Campaign[]; meta: PaginationMeta }> {
    await this.businessAccessService.assertPermission(
      user,
      businessId,
      'campaigns',
      'You do not have permission to view campaigns for this business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const pagination = normalizePagination(page, limit);
    const trimmedSearch = search?.trim();

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .where('campaign.restaurant_id = :businessId', { businessId });

    if (trimmedSearch) {
      const escaped = trimmedSearch.replace(/[%_\\]/g, '\\$&');
      const containsPattern = `%${escaped}%`;

      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('campaign.campaign_name ILIKE :containsPattern', {
              containsPattern,
            })
            .orWhere("COALESCE(campaign.offer, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere(
              "COALESCE(campaign.website_url, '') ILIKE :containsPattern",
              { containsPattern },
            )
            .orWhere("COALESCE(campaign.status::text, '') ILIKE :containsPattern", {
              containsPattern,
            });
        }),
      );
    }

    qb.orderBy('campaign.id', 'DESC')
      .skip(pagination.skip)
      .take(pagination.limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  async getCampaignById(
    campaignId: number,
    user: AuthUser,
  ): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    await this.businessAccessService.assertPermission(
      user,
      campaign.businessId,
      'campaigns',
      'You do not have permission to view campaigns for this business.',
    );

    return campaign;
  }

  async updateCampaign(
    campaignId: number,
    updateCampaignDto: UpdateCampaignDto,
    user: AuthUser,
    file?: Express.Multer.File,
  ): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    await this.businessAccessService.assertPermission(
      user,
      campaign.businessId,
      'campaigns',
      'You do not have permission to update campaigns for this business.',
    );

    if (updateCampaignDto.campaignName !== undefined) {
      campaign.campaignName = updateCampaignDto.campaignName;
    }
    if (updateCampaignDto.websiteUrl !== undefined) {
      campaign.websiteUrl = updateCampaignDto.websiteUrl;
    }
    if (updateCampaignDto.offer !== undefined) {
      campaign.offer = updateCampaignDto.offer;
    }
    if (updateCampaignDto.price !== undefined) {
      campaign.price = updateCampaignDto.price;
    }
    if (updateCampaignDto.status !== undefined) {
      campaign.status = updateCampaignDto.status;
    }

    if (file) {
      campaign.imageUrl = await persistUploadedFile(
        this.spacesService,
        file,
        CAMPAIGNS_UPLOAD_SUBDIR,
        'absolute',
      );
    } else if (updateCampaignDto.imageUrl !== undefined) {
      campaign.imageUrl = toAbsoluteAssetUrlIfRelative(
        updateCampaignDto.imageUrl,
      );
    }

    const saved = await this.campaignRepository.save(campaign);

    await this.businessHistoryService.logCampaignUpdated({
      businessId: saved.businessId,
      campaignId: saved.id,
      campaignName: saved.campaignName,
      actorUserId: user.id,
    });

    return saved;
  }

  async deleteCampaign(
    campaignId: number,
    user: AuthUser,
  ): Promise<{ deleted: true; campaignId: number }> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    await this.businessAccessService.assertPermission(
      user,
      campaign.businessId,
      'campaigns',
      'You do not have permission to delete campaigns for this business.',
    );

    const businessId = campaign.businessId;
    const campaignName = campaign.campaignName;
    const linkedFunnel = await this.funnelRepository.findOne({
      where: { campaignId },
      select: ['id'],
    });
    const linkedFunnelId = linkedFunnel?.id ?? null;

    await this.automationService.deleteAutomationsForCampaign(
      campaignId,
      linkedFunnelId,
    );

    await this.dataSource.transaction(async (manager) => {
      const funnel = await manager.findOne(Funnel, {
        where: { campaignId },
        select: ['id'],
      });
      const funnelId = funnel?.id ?? null;
      const softDeletedAt = new Date();

      const guestIdSet = new Set<number>();
      const collectGuestIds = (
        rows: Array<{ customerId?: number | null }>,
      ): void => {
        for (const row of rows) {
          const id = Number(row.customerId);
          if (Number.isFinite(id) && id > 0) guestIdSet.add(id);
        }
      };

      if (funnelId != null) {
        collectGuestIds(
          await manager.find(FunnelEvent, {
            where: { funnelId, deletedAt: IsNull() },
            select: ['customerId'],
          }),
        );
        collectGuestIds(
          await manager.find(CheckoutAccessToken, {
            where: { funnelId },
            select: ['customerId'],
          }),
        );
      }

      collectGuestIds(
        await manager.find(Coupon, {
          where: { campaignId, deletedAt: IsNull() },
          select: ['customerId'],
        }),
      );
      collectGuestIds(
        await manager.find(CustomerVisit, {
          where: { campaignId, deletedAt: IsNull() },
          select: ['customerId'],
        }),
      );
      collectGuestIds(
        await manager.find(CheckoutAccessToken, {
          where: { campaignId },
          select: ['customerId'],
        }),
      );
      const guestIds = [...guestIdSet];

      await manager.softDelete(CustomerVisit, { campaignId });
      await manager.softDelete(RedemptionLog, { campaignId });

      const tokenDelete = manager
        .createQueryBuilder()
        .delete()
        .from(CheckoutAccessToken)
        .where('campaign_id = :campaignId', { campaignId });
      if (funnelId != null) {
        tokenDelete.orWhere('funnel_id = :funnelId', { funnelId });
      }
      await tokenDelete.execute();

      const couponUpdate = manager
        .createQueryBuilder()
        .update(Coupon)
        .set({
          deletedAt: softDeletedAt,
          funnelPaymentId: null,
        })
        .where('deleted_at IS NULL')
        .andWhere(
          new Brackets((qb) => {
            qb.where('campaign_id = :campaignId', { campaignId });
            if (funnelId != null) {
              qb.orWhere('funnel_id = :funnelId', { funnelId });
            }
          }),
        );
      await couponUpdate.execute();

      if (funnelId != null) {
        await manager
          .createQueryBuilder()
          .update('funnel_order')
          .set({ deleted_at: softDeletedAt })
          .where('funnel_id = :funnelId', { funnelId })
          .andWhere('deleted_at IS NULL')
          .andWhere(`status <> 'paid'`)
          .execute();

        await manager
          .createQueryBuilder()
          .update(FunnelAnalyticsEvent)
          .set({ deletedAt: softDeletedAt })
          .where('funnel_id = :funnelId', { funnelId })
          .andWhere('deleted_at IS NULL')
          .execute();

        await manager
          .createQueryBuilder()
          .update(FunnelEvent)
          .set({ deletedAt: softDeletedAt })
          .where('funnel_id = :funnelId', { funnelId })
          .andWhere('deleted_at IS NULL')
          .andWhere('event_type != :paymentType', {
            paymentType: FunnelEventType.PAYMENT,
          })
          .execute();
      } else {
        await manager
          .createQueryBuilder()
          .update('funnel_order')
          .set({ deleted_at: softDeletedAt })
          .where('campaign_id = :campaignId', { campaignId })
          .andWhere('deleted_at IS NULL')
          .andWhere(`status <> 'paid'`)
          .execute();
      }

      if (funnelId != null) {
        await manager.softDelete(Funnel, { id: funnelId });
      }

      await manager.softDelete(Campaign, { id: campaignId });

      if (guestIds.length > 0) {
        const [linkedEvents, linkedCoupons, linkedVisits, linkedTokens] =
          await Promise.all([
            manager.find(FunnelEvent, {
              where: { customerId: In(guestIds), deletedAt: IsNull() },
              select: ['customerId'],
            }),
            manager.find(Coupon, {
              where: { customerId: In(guestIds), deletedAt: IsNull() },
              select: ['customerId'],
            }),
            manager.find(CustomerVisit, {
              where: { customerId: In(guestIds), deletedAt: IsNull() },
              select: ['customerId'],
            }),
            manager.find(CheckoutAccessToken, {
              where: { customerId: In(guestIds) },
              select: ['customerId'],
            }),
          ]);

        const stillLinked = new Set<number>();
        for (const row of [
          ...linkedEvents,
          ...linkedCoupons,
          ...linkedVisits,
          ...linkedTokens,
        ]) {
          const id = Number(row.customerId);
          if (Number.isFinite(id) && id > 0) stillLinked.add(id);
        }

        const orphanGuestIds = guestIds.filter((id) => !stillLinked.has(id));
        if (orphanGuestIds.length > 0) {
          await manager.softDelete(Customer, { id: In(orphanGuestIds) });
        }
      }
    });

    await this.businessHistoryService.logCampaignDeleted({
      businessId,
      campaignId,
      campaignName,
      actorUserId: user.id,
    });

    return { deleted: true, campaignId };
  }
}
