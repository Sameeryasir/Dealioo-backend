import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from '../../db/entities/campaign.entity';
import { Funnel } from '../../db/entities/funnel.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { isBusinessOwnerScopedUser } from '../../utils/business-access';
import { RedemptionService } from '../redemption/redemption.service';
import { CreateFunnelDto } from './funnelDto/create-funnel.dto';
import { BusinessFunnelSummary } from './funnelDto/business-funnel-summary.dto';
import { UpdateFunnelDto } from './funnelDto/update-funnel.dto';

@Injectable()
export class FunnelService {
  constructor(
    @InjectRepository(Funnel)
    private readonly funnelRepository: Repository<Funnel>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly redemptionService: RedemptionService,
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
      .select(['funnel.id', 'funnel.version'])
      .where('funnel.campaignId = :campaignId', { campaignId });

    if (isBusinessOwnerScopedUser(user)) {
      qb.innerJoin('funnel.campaign', 'campaign')
        .innerJoin('campaign.business', 'business')
        .andWhere('business.owner_id = :userId', { userId: user.id });
    }

    const funnel = await qb.getOne();
    return funnel ? { id: funnel.id, version: funnel.version } : null;
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

  getFunnelBodyByCampaignId(campaignId: number): Promise<Funnel | null> {
    return this.funnelRepository.findOne({
      where: { campaignId },
    });
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
