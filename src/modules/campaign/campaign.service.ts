import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Campaign,
  CampaignPublicationStatus,
} from '../../db/entities/campaign.entity';
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
      status: status ?? CampaignPublicationStatus.UNPUBLISHED,
    });
    return this.campaignRepository.save(campaign);
  }

  async getAllCampaigns(): Promise<Campaign[]> {
    return this.campaignRepository.find();
  }

  async getCampaignsByRestaurantId(
    restaurantId: number,
  ): Promise<Campaign[]> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    return this.campaignRepository.find({
      where: { restaurantId },
    });
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
