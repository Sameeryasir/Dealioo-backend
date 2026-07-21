import {
  ForbiddenException,
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
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { isSuperAdmin } from '../../utils/user-roles';
import { CreateBusinessDto } from './businessDto/create-business.dto';
import { UpdateBusinessDto } from './businessDto/update-business.dto';
import {
  BUSINESSES_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import { BusinessAccessService } from '../business-access/business-access.service';
import { BusinessHistoryService } from '../business-history/business-history.service';
import {
  isValidBusinessSlug,
  slugifyBusinessName,
} from '../../utils/business-slug';
import {
  sanitizeBusinessListItem,
  type PublicBusinessListItem,
} from './sanitize-business-list-item';

const STARTER_PLAN_SLUG = 'starter';
const STARTER_MAX_BUSINESSES = 1;

@Injectable()
export class BusinessService {
  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSubscription)
    private readonly userSubscriptionRepository: Repository<UserSubscription>,
    private readonly spacesService: SpacesService,
    private readonly businessAccessService: BusinessAccessService,
    private readonly businessHistoryService: BusinessHistoryService,
  ) {}

  async findByUserId(userId: number): Promise<Business | null> {
    return this.businessRepository.findOne({
      where: { owner: { id: userId } },
      order: { id: 'ASC' },
    });
  }

  /** Business must exist and belong to this user (for scoped routes like Stripe dashboard). */
  async findOwnedByUserId(
    userId: number,
    businessId: number,
  ): Promise<Business | null> {
    return this.findBusinessForUser({ id: userId, role: null }, businessId);
  }

  async findBusinessForUser(
    user: Pick<User, 'id'> & { role?: { name: string } | null },
    businessId: number,
  ): Promise<Business | null> {
    return this.businessAccessService.findAccessibleBusiness(user, businessId);
  }

  async createBusiness(
    createBusinessDto: CreateBusinessDto,
    user: User,
    file?: Express.Multer.File,
  ): Promise<Business> {
    requireAdminRole(
      user,
      'You do not have permission to create a business.',
    );

    await this.assertStarterBusinessLimit(user.id);

    const {
      name,
      slug: slugInput,
      description,
      logoUrl: dtoLogoUrl,
      websiteUrl,
      email,
      phoneNumber,
      city,
      state,
      country,
      postalCode,
      branchCount,
    } = createBusinessDto;

    const owner = await this.userRepository.findOne({ where: { id: user.id } });
    if (!owner) {
      throw new NotFoundException('Owner not found');
    }

    const logoUrl = file
      ? await persistUploadedFile(
          this.spacesService,
          file,
          BUSINESSES_UPLOAD_SUBDIR,
        )
      : (dtoLogoUrl ?? null);

    const slug = await this.resolveUniqueBusinessSlug(
      slugInput?.trim() || name,
    );

    const business = this.businessRepository.create({
      name,
      slug,
      description,
      logoUrl,
      websiteUrl,
      email,
      phoneNumber,
      city,
      state,
      country,
      postalCode,
      branchCount,
      owner,
      onboardingCompleted: true,
      onboardingCompletedAt: new Date(),
    });

    await this.businessRepository.save(business);

    await this.businessHistoryService.logBusinessCreated({
      businessId: business.id,
      businessName: business.name,
      actorUserId: user.id,
    });

    return business;
  }

  private async assertStarterBusinessLimit(userId: number): Promise<void> {
    const subscription = await this.userSubscriptionRepository
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.plan', 'plan')
      .select(['sub.id', 'plan.id', 'plan.slug'])
      .where('sub.user_id = :userId', { userId })
      .andWhere('sub.status IN (:...statuses)', {
        statuses: ['active', 'trialing'],
      })
      .orderBy('sub.created_at', 'DESC')
      .limit(1)
      .getOne();

    const slug = subscription?.plan?.slug?.trim().toLowerCase() ?? '';
    const isStarter = slug === STARTER_PLAN_SLUG;
    if (!isStarter) return;

    const ownedCount = await this.businessRepository.count({
      where: { owner: { id: userId } },
    });

    if (ownedCount >= STARTER_MAX_BUSINESSES) {
      throw new ForbiddenException(
        'Starter plans allow only one business. Upgrade your plan to add more locations.',
      );
    }
  }

  private async resolveUniqueBusinessSlug(source: string): Promise<string> {
    const base = slugifyBusinessName(source) || 'business';
    const root = isValidBusinessSlug(base) ? base : 'business';

    let candidate = root;
    let suffix = 2;

    while (await this.businessRepository.exists({ where: { slug: candidate } })) {
      candidate = `${root}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  async getAllBusinesses(
    user: User,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ data: PublicBusinessListItem[]; meta: PaginationMeta }> {
    const pagination = normalizePagination(page, limit);
    const trimmedSearch = search?.trim();
    const listAllBusinesses = isSuperAdmin(user);

    const qb = this.businessRepository.createQueryBuilder('business');

    if (!listAllBusinesses) {
      this.businessAccessService.applyAccessibleBusinessFilter(qb, user);
    }

    if (trimmedSearch) {
      const escaped = trimmedSearch.replace(/[%_\\]/g, '\\$&');
      const containsPattern = `%${escaped}%`;

      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('business.name ILIKE :containsPattern', {
              containsPattern,
            })
            .orWhere(
              "COALESCE(business.description, '') ILIKE :containsPattern",
              { containsPattern },
            )
            .orWhere("COALESCE(business.email, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere("COALESCE(business.city, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere("COALESCE(business.state, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere("COALESCE(business.country, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere(
              "COALESCE(business.website_url, '') ILIKE :containsPattern",
              { containsPattern },
            );
        }),
      );
    }

    qb.orderBy('business.id', 'ASC')
      .skip(pagination.skip)
      .take(pagination.limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      data: rows.map(sanitizeBusinessListItem),
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }
  async getBusinessById(
    businessId: number,
    user: User,
  ): Promise<Business> {
    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not have access to this business.',
      );
    }
    return business;
  }
  async updateBusiness(
    businessId: number,
    updateBusinessDto: UpdateBusinessDto,
    user: User,
    file?: Express.Multer.File,
  ): Promise<Business> {
    await this.businessAccessService.assertPermission(
      user,
      businessId,
      'settings',
      'You do not have permission to update a business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }
    const {
      name,
      description,
      logoUrl,
      websiteUrl,
      email,
      phoneNumber,
      city,
      state,
      country,
      postalCode,
      branchCount,
    } = updateBusinessDto;

    if (name !== undefined) business.name = name;
    if (description !== undefined) business.description = description;
    if (file) {
      business.logoUrl = await persistUploadedFile(
        this.spacesService,
        file,
        BUSINESSES_UPLOAD_SUBDIR,
      );
    } else if (logoUrl !== undefined) {
      business.logoUrl = logoUrl;
    }
    if (websiteUrl !== undefined) business.websiteUrl = websiteUrl;
    if (email !== undefined) business.email = email;
    if (phoneNumber !== undefined) business.phoneNumber = phoneNumber;
    if (city !== undefined) business.city = city;
    if (state !== undefined) business.state = state;
    if (country !== undefined) business.country = country;
    if (postalCode !== undefined) business.postalCode = postalCode;
    if (branchCount !== undefined) business.branchCount = branchCount;

    const saved = await this.businessRepository.save(business);

    await this.businessHistoryService.logBusinessUpdated({
      businessId: saved.id,
      businessName: saved.name,
      actorUserId: user.id,
    });

    return saved;
  }
  async deleteBusiness(businessId: number, user: User): Promise<Business> {
    await this.businessAccessService.assertOwner(
      user,
      businessId,
      'Only the business owner can delete a business.',
    );

    const business = await this.businessAccessService.findAccessibleBusiness(
      user,
      businessId,
    );
    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    await this.businessHistoryService.logBusinessDeleted({
      businessId: business.id,
      businessName: business.name,
      actorUserId: user.id,
    });

    await this.businessRepository.delete(businessId);
    return business;
  }
  
}
