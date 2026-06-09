import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { CreateFunnelDto } from './funnelDto/create-funnel.dto';
import { RestaurantFunnelSummary } from './funnelDto/restaurant-funnel-summary.dto';
import { UpdateFunnelDto } from './funnelDto/update-funnel.dto';

@Injectable()
export class FunnelService {
  constructor(
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
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
        version: 1,
        updatedBy: { id: user.id } as User,
      });

      return this.funnelRepository.save(funnel);
    }

    funnel.pages = dto.pages ?? funnel.pages;

    funnel.version += 1;

    funnel.updatedBy = { id: user.id } as User;

    return this.funnelRepository.save(funnel);
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

  async getFunnelsByRestaurantId(
    restaurantId: number,
  ): Promise<RestaurantFunnelSummary[]> {
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const funnels = await this.funnelRepository.find({
      where: {
        campaign: { restaurantId },
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

  /** One funnel per campaign: returns that row or null if none exists yet. */
  async getFunnelByCampaignId(campaignId: number): Promise<Funnel | null> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return this.funnelRepository.findOne({
      where: { campaignId },
      relations: ['updatedBy'],
    });
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

    if (dto.expectedVersion !== funnel.version) {
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
    funnel.version = funnel.version + 1;
    funnel.updatedBy = { id: user.id } as User;

    return this.funnelRepository.save(funnel);
  }

  async deleteFunnel(id: number, user: User): Promise<void> {
    requireAdminRole(
      user,
      'You do not have permission to delete a funnel.',
    );

    const result = await this.funnelRepository.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException('Funnel not found');
    }
  }
}
