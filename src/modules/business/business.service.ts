import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { businessAccessWhere } from '../../utils/business-access';
import { isSuperAdmin } from '../../utils/user-roles';
import { CreateBusinessDto } from './businessDto/create-business.dto';
import { UpdateBusinessDto } from './businessDto/update-business.dto';
import {
  BUSINESSES_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import {
  isValidBusinessSlug,
  slugifyBusinessName,
} from '../../utils/business-slug';

const STARTER_MAX_BUSINESSES = 1;

function isStarterPlanSlug(planSlug: string | null | undefined): boolean {
  const slug = planSlug?.trim().toLowerCase() ?? '';
  return slug === 'starter' || slug.startsWith('starter-');
}

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
    return this.businessRepository.findOne({
      where: businessAccessWhere(user, businessId),
    });
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

    const subscription = await this.userSubscriptionRepository.findOne({
      where: { userId: user.id, status: In(['active', 'trialing']) },
      relations: { plan: true },
      order: { createdAt: 'DESC' },
    });
    if (isStarterPlanSlug(subscription?.plan?.slug)) {
      const ownedCount = await this.businessRepository.count({
        where: { owner: { id: user.id } },
      });
      if (ownedCount >= STARTER_MAX_BUSINESSES) {
        throw new ForbiddenException(
          'Your Starter plan includes one business. Please upgrade your subscription to add more businesses.',
        );
      }
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

    return business;
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
  ): Promise<{ data: Business[]; meta: PaginationMeta }> {
    requireAdminRole(
      user,
      'You do not have permission to get all businesses.',
    );

    const pagination = normalizePagination(page, limit);
    const trimmedSearch = search?.trim();
    const listAllBusinesses = isSuperAdmin(user);

    const qb = this.businessRepository.createQueryBuilder('business');

    if (!listAllBusinesses) {
      qb.where('business.owner_id = :ownerId', { ownerId: user.id });
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

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }
  async getBusinessById(
    businessId: number,
    user: User,
  ): Promise<Business> {
    requireAdminRole(
      user,
      'You do not have permission to get business by id.',
    );

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    return business;
  }
  async updateBusiness(
    businessId: number,
    updateBusinessDto: UpdateBusinessDto,
    user: User,
    file?: Express.Multer.File,
  ): Promise<Business> {
    requireAdminRole(user, 'You do not have permission to update a business.');

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
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

    return this.businessRepository.save(business);
  }
  async deleteBusiness(businessId: number, user: User): Promise<Business> {
    requireAdminRole(user, 'You do not have permission to delete a business.');

    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) {
      throw new NotFoundException('Business not found');
    }
    await this.businessRepository.delete(businessId);
    return business;
  }
  
}
