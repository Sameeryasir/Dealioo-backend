import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { CreateFunnelDto } from './funnelDto/create-funnel.dto';
import { UpdateFunnelDto } from './funnelDto/update-funnel.dto';

@Injectable()
export class FunnelService {
  constructor(
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  async createFunnel(dto: CreateFunnelDto, user: User): Promise<Funnel> {
    requireAdminRole(
      user,
      'You do not have permission to create a funnel.',
    );

    const campaign = await this.campaignRepository.findOne({
      where: { id: dto.campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const funnel = this.funnelRepository.create({
      campaign,
      campaignId: campaign.id,
      pages: dto.pages ?? {},
      published: false,
      version: 1,
      updatedBy: { id: user.id } as User,
    });

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

  async getFunnelsByCampaignId(campaignId: number): Promise<Funnel[]> {
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return this.funnelRepository.find({
      where: { campaignId },
      relations: ['updatedBy'],
      order: { id: 'ASC' },
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
