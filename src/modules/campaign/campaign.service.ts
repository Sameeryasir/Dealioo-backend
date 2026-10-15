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
  CampaignDiscountType,
  CampaignPublicationStatus,
  CampaignType,
} from '../../db/entities/campaign.entity';
import { CheckoutAccessToken } from '../../db/entities/checkout-access-token.entity';
import { Coupon } from '../../db/entities/coupon.entity';
import { Customer } from '../../db/entities/customer.entity';
import { CustomerVisit } from '../../db/entities/customer-visit.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { FunnelVersion } from '../../db/entities/funnel-version.entity';
import { FunnelPagesService } from '../funnel-pages/funnel-pages.service';
import { FunnelAnalyticsEvent } from '../../db/entities/funnel-analytics-event.entity';
import {
  FunnelEvent,
  FunnelEventType,
} from '../../db/entities/funnel-event.entity';
import {
  FunnelPayment,
  FunnelPaymentStatus,
} from '../../db/entities/funnel-payment.entity';
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
import { campaignPermissionKeysFor } from '../member/member.constants';
import { PusherService } from '../pusher/pusher.service';
import type { CampaignActivityPusherPayload } from '../pusher/pusher.types';
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
    @InjectRepository(FunnelVersion)
    private readonly funnelVersionRepository: Repository<FunnelVersion>,
    private readonly dataSource: DataSource,
    private readonly spacesService: SpacesService,
    private readonly stripeCatalogService: StripeCatalogService,
    private readonly businessAccessService: BusinessAccessService,
    private readonly automationService: AutomationService,
    private readonly businessHistoryService: BusinessHistoryService,
    private readonly funnelPagesService: FunnelPagesService,
    private readonly pusherService: PusherService,
  ) {}

  private emitCampaignActivity(params: {
    businessId: number;
    eventType: CampaignActivityPusherPayload['eventType'];
    campaignId: number;
    campaignName: string;
    actorUserId: number | null;
    description: string;
  }): void {
    const campaignName =
      params.campaignName.trim() || `Campaign #${params.campaignId}`;
    void this.pusherService
      .notifyCampaignActivity({
        businessId: params.businessId,
        eventType: params.eventType,
        campaignId: params.campaignId,
        campaignName,
        description: params.description.trim() || campaignName,
        actorUserId: params.actorUserId,
        actorName: null,
        occurredAt: new Date().toISOString(),
      })
      .catch(() => undefined);
  }

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
      campaignType,
      websiteUrl,
      imageUrl: dtoImageUrl,
      offer,
      description,
      price,
      originalPrice,
      discountType,
      discountValue,
      status,
    } = createCampaignDto;

    this.assertDealPricing(price ?? null, originalPrice ?? null);
    this.assertDiscountFields(
      originalPrice ?? null,
      discountType ?? null,
      discountValue ?? null,
    );

    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['campaigns_create', 'campaigns'],
      'You do not have permission to create campaigns for this business.',
    );

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business || business.deletedAt) {
      throw new NotFoundException('Business not found');
    }

    if (
      campaignType !== CampaignType.POSTPAID &&
      !business.stripeAccountId?.trim()
    ) {
      throw new BadRequestException(
        'Connect Stripe for this business before creating a prepaid campaign. A Stripe product ID is required so each payment can be matched to the correct campaign offer.',
      );
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
      campaignType,
      websiteUrl,
      imageUrl,
      offer: offer.trim(),
      description: createCampaignDto.description.trim(),
      price: price ?? null,
      originalPrice: originalPrice ?? null,
      discountType: originalPrice != null ? (discountType ?? null) : null,
      discountValue: originalPrice != null ? (discountValue ?? null) : null,
      status: status ?? CampaignPublicationStatus.PUBLISHED,
    });
    const savedCampaign = await this.campaignRepository.save(campaign);

    const funnel = this.funnelRepository.create({
      campaign: savedCampaign,
      campaignId: savedCampaign.id,
      businessId: business.id,
      published: false,
      contentRevision: 0,
    });
    const savedFunnel = await this.funnelRepository.save(funnel);
    await Promise.all([
      this.funnelPagesService.initializeEmptyPages({
        funnelId: savedFunnel.id,
        businessId: business.id,
        createdById: user.id,
        includePaymentPage: campaignType !== CampaignType.POSTPAID,
        campaignName: savedCampaign.campaignName,
        offer: savedCampaign.offer,
        description: savedCampaign.description,
      }),
      this.funnelVersionRepository.save(
        this.funnelVersionRepository.create({
          funnelId: savedFunnel.id,
          businessId: business.id,
          versionNumber: 1,
          schema: {},
          operationId: null,
          createdById: user.id,
        }),
      ),
    ]);

    if (
      campaignType !== CampaignType.POSTPAID &&
      business.stripeAccountId?.trim()
    ) {
      void this.stripeCatalogService
        .createCatalogForNewCampaign({
          campaign: savedCampaign,
          stripeAccountId: business.stripeAccountId,
          currency: business.currency,
        })
        .catch(() => undefined);
    }

    void this.businessHistoryService
      .logCampaignCreated({
        businessId: savedCampaign.businessId,
        campaignId: savedCampaign.id,
        campaignName: savedCampaign.campaignName,
        actorUserId: user.id,
      })
      .catch(() => undefined);

    this.emitCampaignActivity({
      businessId: savedCampaign.businessId,
      eventType: 'campaign_created',
      campaignId: savedCampaign.id,
      campaignName: savedCampaign.campaignName,
      actorUserId: user.id,
      description: `Created campaign "${savedCampaign.campaignName?.trim() || savedCampaign.id}"`,
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
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      campaignPermissionKeysFor('view'),
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
      .where('campaign.business_id = :businessId', { businessId });

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
            .orWhere(
              "COALESCE(campaign.status::text, '') ILIKE :containsPattern",
              {
                containsPattern,
              },
            );
        }),
      );
    }

    qb.orderBy('campaign.id', 'DESC')
      .skip(pagination.skip)
      .take(pagination.limit);

    const [data, total] = await qb.getManyAndCount();
    const withRatings = await this.attachCampaignReviewRatings(data);

    return {
      data: withRatings,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }

  private async attachCampaignReviewRatings(campaigns: Campaign[]): Promise<
    Array<
      Campaign & {
        averageRating: number | null;
        totalReviews: number;
      }
    >
  > {
    if (campaigns.length === 0) {
      return [];
    }

    const campaignIds = campaigns.map((campaign) => campaign.id);
    const rows = await this.dataSource.query(
      `
        SELECT
          campaign_id AS "campaignId",
          COUNT(*)::int AS "totalReviews",
          AVG(rating)::float AS "averageRating"
        FROM campaign_review
        WHERE campaign_id = ANY($1)
          AND status = 'submitted'
          AND rating IS NOT NULL
        GROUP BY campaign_id
      `,
      [campaignIds],
    );

    const byCampaignId = new Map(
      rows.map((row) => {
        const totalReviews = Number(row.totalReviews) || 0;
        const averageRaw =
          row.averageRating == null ? null : Number(row.averageRating);
        const averageRating =
          totalReviews > 0 && averageRaw != null && Number.isFinite(averageRaw)
            ? Math.round(averageRaw * 10) / 10
            : null;
        return [
          Number(row.campaignId),
          { totalReviews, averageRating },
        ] as const;
      }),
    );

    return campaigns.map((campaign) => {
      const summary = byCampaignId.get(campaign.id);
      return Object.assign(campaign, {
        averageRating: summary?.averageRating ?? null,
        totalReviews: summary?.totalReviews ?? 0,
      });
    });
  }

  async getCampaignById(campaignId: number, user: AuthUser): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    await this.businessAccessService.assertAnyPermission(
      user,
      campaign.businessId,
      campaignPermissionKeysFor('view'),
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

    await this.businessAccessService.assertAnyPermission(
      user,
      campaign.businessId,
      campaignPermissionKeysFor('campaigns_edit'),
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
    if (updateCampaignDto.description !== undefined) {
      campaign.description = updateCampaignDto.description.trim();
    }
    const previousPrice =
      campaign.price != null ? Number(campaign.price) : null;

    if (updateCampaignDto.price !== undefined) {
      campaign.price = updateCampaignDto.price;
    }
    if (updateCampaignDto.originalPrice !== undefined) {
      campaign.originalPrice = updateCampaignDto.originalPrice;
    }
    if (updateCampaignDto.discountType !== undefined) {
      campaign.discountType = updateCampaignDto.discountType;
    }
    if (updateCampaignDto.discountValue !== undefined) {
      campaign.discountValue = updateCampaignDto.discountValue;
    }

    if (campaign.originalPrice == null) {
      campaign.discountType = null;
      campaign.discountValue = null;
    }

    this.assertDealPricing(
      campaign.price != null ? Number(campaign.price) : null,
      campaign.originalPrice != null ? Number(campaign.originalPrice) : null,
    );
    this.assertDiscountFields(
      campaign.originalPrice != null ? Number(campaign.originalPrice) : null,
      campaign.discountType,
      campaign.discountValue != null ? Number(campaign.discountValue) : null,
    );

    const previousStatus = campaign.status;
    const becomingUnpublished =
      updateCampaignDto.status === CampaignPublicationStatus.UNPUBLISHED &&
      campaign.status !== CampaignPublicationStatus.UNPUBLISHED;
    if (becomingUnpublished) {
      await this.automationService.assertNoActiveAutomationsForCampaign(
        campaign.id,
      );
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

    const nextPrice = saved.price != null ? Number(saved.price) : null;
    const priceChanged =
      updateCampaignDto.price !== undefined &&
      previousPrice !== nextPrice &&
      (previousPrice == null ||
        nextPrice == null ||
        Math.abs(previousPrice - nextPrice) >= 0.005);
    if (
      priceChanged &&
      saved.campaignType !== CampaignType.POSTPAID &&
      nextPrice != null
    ) {
      void this.syncStripeCatalogAfterPriceChange(saved).catch(() => undefined);
    }

    if (updateCampaignDto.offer !== undefined) {
      await this.funnelPagesService.ensureLandingEyebrowForCampaign(
        saved.id,
        saved.offer,
      );
    }

    if (updateCampaignDto.status !== undefined) {
      await this.funnelRepository.update(
        { campaignId: saved.id },
        {
          published: saved.status === CampaignPublicationStatus.PUBLISHED,
        },
      );
    }

    await this.businessHistoryService.logCampaignUpdated({
      businessId: saved.businessId,
      campaignId: saved.id,
      campaignName: saved.campaignName,
      actorUserId: user.id,
      previousStatus:
        updateCampaignDto.status !== undefined ? previousStatus : null,
      status: updateCampaignDto.status !== undefined ? saved.status : null,
    });

    const previous =
      updateCampaignDto.status !== undefined
        ? (previousStatus?.trim().toLowerCase() ?? '')
        : '';
    const next =
      updateCampaignDto.status !== undefined
        ? (saved.status?.trim().toLowerCase() ?? '')
        : '';
    let description = `Updated campaign "${saved.campaignName?.trim() || saved.id}"`;
    if (previous && next && previous !== next) {
      if (next === 'published') {
        description = `Published campaign "${saved.campaignName?.trim() || saved.id}"`;
      } else if (next === 'unpublished') {
        description = `Unpublished campaign "${saved.campaignName?.trim() || saved.id}"`;
      }
    }

    this.emitCampaignActivity({
      businessId: saved.businessId,
      eventType: 'campaign_updated',
      campaignId: saved.id,
      campaignName: saved.campaignName,
      actorUserId: user.id,
      description,
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

    await this.businessAccessService.assertAnyPermission(
      user,
      campaign.businessId,
      ['campaigns_delete', 'campaigns'],
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
          .update(FunnelPayment)
          .set({ deletedAt: softDeletedAt })
          .where('funnel_id = :funnelId', { funnelId })
          .andWhere('deleted_at IS NULL')
          .andWhere('status <> :paidStatus', {
            paidStatus: FunnelPaymentStatus.PAID,
          })
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
          .update(FunnelPayment)
          .set({ deletedAt: softDeletedAt })
          .where('campaign_id = :campaignId', { campaignId })
          .andWhere('deleted_at IS NULL')
          .andWhere('status <> :paidStatus', {
            paidStatus: FunnelPaymentStatus.PAID,
          })
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

    this.emitCampaignActivity({
      businessId,
      eventType: 'campaign_deleted',
      campaignId,
      campaignName,
      actorUserId: user.id,
      description: `Deleted campaign "${campaignName?.trim() || campaignId}"`,
    });

    return { deleted: true, campaignId };
  }

  private assertDealPricing(
    price: number | null,
    originalPrice: number | null,
  ): void {
    if (originalPrice == null) return;

    if (price == null) {
      throw new BadRequestException(
        'Set a deal price before adding an original price.',
      );
    }

    if (!Number.isFinite(price) || price < 0 || price > 999_999.99) {
      throw new BadRequestException('Enter a valid deal price.');
    }

    if (
      !Number.isFinite(originalPrice) ||
      originalPrice < 0 ||
      originalPrice > 999_999.99
    ) {
      throw new BadRequestException('Enter a valid original price.');
    }

    if (!(originalPrice > price)) {
      throw new BadRequestException(
        'Original price must be higher than the deal price to show a discount.',
      );
    }
  }

  private assertDiscountFields(
    originalPrice: number | null,
    discountType: CampaignDiscountType | null,
    discountValue: number | null,
  ): void {
    if (originalPrice == null) return;
    if (discountType == null && discountValue == null) return;

    if (
      discountType !== CampaignDiscountType.PERCENT &&
      discountType !== CampaignDiscountType.FIXED
    ) {
      throw new BadRequestException(
        'Discount type must be percent or fixed when set.',
      );
    }

    if (
      discountValue == null ||
      !Number.isFinite(discountValue) ||
      discountValue <= 0
    ) {
      throw new BadRequestException('Enter a valid discount value.');
    }

    if (
      discountType === CampaignDiscountType.PERCENT &&
      (discountValue < 1 || discountValue >= 100)
    ) {
      throw new BadRequestException(
        'Percent discount must be between 1 and 99.',
      );
    }
  }

  private async syncStripeCatalogAfterPriceChange(
    campaign: Campaign,
  ): Promise<void> {
    const business = await this.businessRepository.findOne({
      where: { id: campaign.businessId },
    });
    const stripeAccountId = business?.stripeAccountId?.trim();
    if (!stripeAccountId || business?.deletedAt) return;

    await this.stripeCatalogService.ensureCampaignCatalogOnConnectedAccount({
      campaign,
      stripeAccountId,
      currency: (business.currency?.trim() || 'usd').toLowerCase(),
    });
  }
}
