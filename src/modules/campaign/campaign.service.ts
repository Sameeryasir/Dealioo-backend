import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import {
  Campaign,
  CampaignPublicationStatus,
} from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import {
  CAMPAIGNS_UPLOAD_SUBDIR,
  toAbsoluteAssetUrlIfRelative,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import { StripeCatalogService } from '../stripe/stripe-catalog.service';
import { BusinessAccessService } from '../business-access/business-access.service';
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

    return this.campaignRepository.save(campaign);
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

    await this.dataSource.transaction(async (manager) => {
      const funnel = await manager.findOne(Funnel, {
        where: { campaignId },
        select: ['id'],
      });
      const funnelId = funnel?.id ?? null;

      const guestIdSet = new Set<number>();

      if (funnelId != null) {
        const funnelGuestRows: Array<{ id: string | number }> =
          await manager.query(
            `
              SELECT DISTINCT customer_id AS id
              FROM funnel_event
              WHERE funnel_id = $1 AND customer_id IS NOT NULL
            `,
            [funnelId],
          );
        for (const row of funnelGuestRows) {
          const id = Number(row.id);
          if (Number.isFinite(id) && id > 0) guestIdSet.add(id);
        }

        const checkoutGuestRows: Array<{ id: string | number }> =
          await manager.query(
            `
              SELECT DISTINCT customer_id AS id
              FROM checkout_access_token
              WHERE funnel_id = $1
            `,
            [funnelId],
          );
        for (const row of checkoutGuestRows) {
          const id = Number(row.id);
          if (Number.isFinite(id) && id > 0) guestIdSet.add(id);
        }
      }

      const campaignGuestRows: Array<{ id: string | number }> =
        await manager.query(
          `
            SELECT DISTINCT customer_id AS id FROM (
              SELECT customer_id FROM coupons WHERE campaign_id = $1
              UNION
              SELECT customer_id FROM customer_visits WHERE campaign_id = $1
              UNION
              SELECT customer_id FROM checkout_access_token WHERE campaign_id = $1
            ) campaign_guests
            WHERE customer_id IS NOT NULL
          `,
          [campaignId],
        );
      for (const row of campaignGuestRows) {
        const id = Number(row.id);
        if (Number.isFinite(id) && id > 0) guestIdSet.add(id);
      }
      const guestIds = [...guestIdSet];

      await manager.query(
        `DELETE FROM customer_visits WHERE campaign_id = $1`,
        [campaignId],
      );

      await manager.query(
        `DELETE FROM redemption_logs WHERE campaign_id = $1`,
        [campaignId],
      );

      await manager.query(
        `
          DELETE FROM checkout_access_token
          WHERE campaign_id = $1
             OR ($2::int IS NOT NULL AND funnel_id = $2)
        `,
        [campaignId, funnelId],
      );

      await manager.query(
        `UPDATE coupons SET funnel_payment_id = NULL WHERE campaign_id = $1 OR ($2::int IS NOT NULL AND funnel_id = $2)`,
        [campaignId, funnelId],
      );

      await manager.query(
        `
          DELETE FROM coupons
          WHERE campaign_id = $1
             OR ($2::int IS NOT NULL AND funnel_id = $2)
        `,
        [campaignId, funnelId],
      );

      await manager.query(
        `
          DELETE FROM funnel_payment
          WHERE campaign_id = $1
             OR ($2::int IS NOT NULL AND funnel_id = $2)
        `,
        [campaignId, funnelId],
      );

      if (funnelId != null) {
        await manager.query(`DELETE FROM funnel_order WHERE funnel_id = $1`, [
          funnelId,
        ]);
        await manager.query(
          `DELETE FROM funnel_analytics_event WHERE funnel_id = $1`,
          [funnelId],
        );
        await manager.query(`DELETE FROM funnel_event WHERE funnel_id = $1`, [
          funnelId,
        ]);
      } else {
        await manager.query(`DELETE FROM funnel_order WHERE campaign_id = $1`, [
          campaignId,
        ]);
      }

      await manager.query(
        `
          UPDATE automation
          SET campaign_id = NULL,
              funnel_id = CASE
                WHEN funnel_id = $2 THEN NULL
                ELSE funnel_id
              END
          WHERE campaign_id = $1
             OR ($2::int IS NOT NULL AND funnel_id = $2)
        `,
        [campaignId, funnelId],
      );

      if (funnelId != null) {
        await manager.query(`DELETE FROM funnels WHERE id = $1`, [funnelId]);
      }

      await manager.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);

      if (guestIds.length > 0) {
        await manager.query(
          `
            DELETE FROM customers c
            WHERE c.id = ANY($1::int[])
              AND NOT EXISTS (
                SELECT 1 FROM funnel_event fe WHERE fe.customer_id = c.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM coupons cp WHERE cp.customer_id = c.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM customer_visits cv WHERE cv.customer_id = c.id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM checkout_access_token cat
                WHERE cat.customer_id = c.id
              )
          `,
          [guestIds],
        );
      }
    });

    return { deleted: true, campaignId };
  }
}
