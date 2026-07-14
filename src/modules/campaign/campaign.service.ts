import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { Business } from '../../db/entities/business.entity';
import {
  CAMPAIGNS_UPLOAD_SUBDIR,
  toAbsoluteAssetUrlIfRelative,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import { CreateCampaignDto } from './campaignDto/create-campaign.dto';
import { UpdateCampaignDto } from './campaignDto/update-campaign.dto';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    private readonly spacesService: SpacesService,
  ) {}

  /**
   * Change: Standalone hero/funnel image upload for the CRM editor.
   * Why: Frontend posts to POST /campaign/upload-image; route was missing.
   * Related: CampaignController.uploadImage, upload-campaign-image.ts
   */
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

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
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

    return savedCampaign;
  }

  async getAllCampaigns(): Promise<Campaign[]> {
    return this.campaignRepository.find();
  }

  async getCampaignsByBusinessId(
    businessId: number,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ data: Campaign[]; meta: PaginationMeta }> {
    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
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
}
