import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
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
import { Restaurant } from '../../db/entities/restaurant.entity';
import {
  absolutePublicUploadFileUrl,
  CAMPAIGNS_UPLOAD_SUBDIR,
  toAbsoluteAssetUrlIfRelative,
} from '../../utils/disk-file-upload-multer';
import { CreateCampaignDto } from './campaignDto/create-campaign.dto';
import { UpdateCampaignDto } from './campaignDto/update-campaign.dto';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
  ) {}

  async createCampaign(
    createCampaignDto: CreateCampaignDto,
    file?: Express.Multer.File,
  ): Promise<Campaign> {
    const {
      restaurantId,
      campaignName,
      websiteUrl,
      imageUrl: dtoImageUrl,
      offer,
      price,
      status,
    } = createCampaignDto;

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const imageUrl = file
      ? absolutePublicUploadFileUrl(CAMPAIGNS_UPLOAD_SUBDIR, file.filename)
      : toAbsoluteAssetUrlIfRelative(dtoImageUrl);
    const campaign = this.campaignRepository.create({
      restaurant,
      restaurantId: restaurant.id,
      campaignName,
      websiteUrl,
      imageUrl,
      offer: offer ?? null,
      price: price ?? null,
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

    return savedCampaign;
  }

  async getAllCampaigns(): Promise<Campaign[]> {
    return this.campaignRepository.find();
  }

  async getCampaignsByRestaurantId(
    restaurantId: number,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ data: Campaign[]; meta: PaginationMeta }> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const pagination = normalizePagination(page, limit);
    const trimmedSearch = search?.trim();

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .where('campaign.restaurant_id = :restaurantId', { restaurantId });

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

  async getCampaignById(campaignId: number): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }

  async updateCampaign(
    campaignId: number,
    updateCampaignDto: UpdateCampaignDto,
    file?: Express.Multer.File,
  ): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

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
      campaign.imageUrl = absolutePublicUploadFileUrl(
        CAMPAIGNS_UPLOAD_SUBDIR,
        file.filename,
      );
    } else if (updateCampaignDto.imageUrl !== undefined) {
      campaign.imageUrl = toAbsoluteAssetUrlIfRelative(
        updateCampaignDto.imageUrl,
      );
    }

    return this.campaignRepository.save(campaign);
  }
}
