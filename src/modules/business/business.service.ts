import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
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

@Injectable()
export class BusinessService {
  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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
    return this.businessRepository.findOne({
      where: { id: businessId, owner: { id: userId } },
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
      cuisineType,
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
      cuisineType,
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

    const qb = this.businessRepository
      .createQueryBuilder('business')
      .where('business.owner_id = :ownerId', { ownerId: user.id });

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
            .orWhere(
              "COALESCE(business.cuisine_type, '') ILIKE :containsPattern",
              { containsPattern },
            )
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
      relations: ['menu'],
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
      logoUrl,
      websiteUrl,
      email,
      phoneNumber,
      branchCount,
    } = updateBusinessDto;

    if (name !== undefined) business.name = name;
    if (logoUrl !== undefined) business.logoUrl = logoUrl;
    if (websiteUrl !== undefined) business.websiteUrl = websiteUrl;
    if (email !== undefined) business.email = email;
    if (phoneNumber !== undefined) business.phoneNumber = phoneNumber;
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
