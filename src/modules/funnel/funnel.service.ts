import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Funnel,
  FunnelPublicationStatus,
} from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import {
  FUNNELS_UPLOAD_SUBDIR,
  publicUploadFileUrl,
} from '../../utils/disk-file-upload-multer';
import { CreateFunnelDto } from './funnelDto/create-funnel.dto';

@Injectable()
export class FunnelService {
  constructor(
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
  ) {}

  async createFunnel(
    createFunnelDto: CreateFunnelDto,
    file?: Express.Multer.File,
  ): Promise<Funnel> {
    const {
      restaurantId,
      campaignName,
      websiteUrl,
      imageUrl: dtoImageUrl,
      offer,
      price,
      status,
    } = createFunnelDto;

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const imageUrl = file
      ? publicUploadFileUrl(FUNNELS_UPLOAD_SUBDIR, file.filename)
      : (dtoImageUrl ?? null);
    const funnel = this.funnelRepository.create({
      restaurant,
      restaurantId: restaurant.id,
      campaignName,
      websiteUrl,
      imageUrl,
      offer: offer ?? null,
      price: price ?? null,
      status: status ?? FunnelPublicationStatus.UNPUBLISHED,
    });
    return this.funnelRepository.save(funnel);
  }
  async getAllFunnels(): Promise<Funnel[]> {
    return this.funnelRepository.find({ relations: ['restaurant'] });
  }

  async getFunnelsByRestaurantId(restaurantId: number): Promise<Funnel[]> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    return this.funnelRepository.find({
      where: { restaurantId },
      relations: ['restaurant'],
    });
  }
}
