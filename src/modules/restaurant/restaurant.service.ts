import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { CreateRestaurantDto } from './restaurantDto/create-restaurant.dto';
import { UpdateRestaurantDto } from './restaurantDto/update-restaurant.dto';
import {
  RESTAURANTS_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import { persistUploadedFile } from '../../utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';

@Injectable()
export class RestaurantService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly spacesService: SpacesService,
  ) {}

  async findByUserId(userId: number): Promise<Restaurant | null> {
    return this.restaurantRepository.findOne({
      where: { owner: { id: userId } },
      order: { id: 'ASC' },
    });
  }

  /** Restaurant must exist and belong to this user (for scoped routes like Stripe dashboard). */
  async findOwnedByUserId(
    userId: number,
    restaurantId: number,
  ): Promise<Restaurant | null> {
    return this.restaurantRepository.findOne({
      where: { id: restaurantId, owner: { id: userId } },
    });
  }

  async createRestaurant(
    createRestaurantDto: CreateRestaurantDto,
    user: User,
    file?: Express.Multer.File,
  ): Promise<Restaurant> {
    requireAdminRole(
      user,
      'You do not have permission to create a restaurant.',
    );

    const {
      name,
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
    } = createRestaurantDto;

    const owner = await this.userRepository.findOne({ where: { id: user.id } });
    if (!owner) {
      throw new NotFoundException('Owner not found');
    }

    const logoUrl = file
      ? await persistUploadedFile(
          this.spacesService,
          file,
          RESTAURANTS_UPLOAD_SUBDIR,
        )
      : (dtoLogoUrl ?? null);

    const restaurant = this.restaurantRepository.create({
      name,
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
    });

    await this.restaurantRepository.save(restaurant);

    return restaurant;
  }
  async getAllRestaurants(
    user: User,
    page?: number,
    limit?: number,
    search?: string,
  ): Promise<{ data: Restaurant[]; meta: PaginationMeta }> {
    requireAdminRole(
      user,
      'You do not have permission to get all restaurants.',
    );

    const pagination = normalizePagination(page, limit);
    const trimmedSearch = search?.trim();

    const qb = this.restaurantRepository
      .createQueryBuilder('restaurant')
      .where('restaurant.owner_id = :ownerId', { ownerId: user.id });

    if (trimmedSearch) {
      const escaped = trimmedSearch.replace(/[%_\\]/g, '\\$&');
      const containsPattern = `%${escaped}%`;

      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('restaurant.name ILIKE :containsPattern', {
              containsPattern,
            })
            .orWhere(
              "COALESCE(restaurant.description, '') ILIKE :containsPattern",
              { containsPattern },
            )
            .orWhere("COALESCE(restaurant.email, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere(
              "COALESCE(restaurant.cuisine_type, '') ILIKE :containsPattern",
              { containsPattern },
            )
            .orWhere("COALESCE(restaurant.city, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere("COALESCE(restaurant.state, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere("COALESCE(restaurant.country, '') ILIKE :containsPattern", {
              containsPattern,
            })
            .orWhere(
              "COALESCE(restaurant.website_url, '') ILIKE :containsPattern",
              { containsPattern },
            );
        }),
      );
    }

    qb.orderBy('restaurant.id', 'ASC')
      .skip(pagination.skip)
      .take(pagination.limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: buildPaginationMeta(total, pagination.page, pagination.limit),
    };
  }
  async getRestaurantById(
    restaurantId: number,
    user: User,
  ): Promise<Restaurant> {
    requireAdminRole(
      user,
      'You do not have permission to get restaurant by id.',
    );

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
      relations: ['menu'],
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    return restaurant;
  }
  async updateRestaurant(
    restaurantId: number,
    updateRestaurantDto: UpdateRestaurantDto,
    user: User,
  ): Promise<Restaurant> {
    requireAdminRole(user, 'You do not have permission to update restaurant.');

    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    const {
      name,
      logoUrl,
      websiteUrl,
      email,
      phoneNumber,
      branchCount,
    } = updateRestaurantDto;

    if (name !== undefined) restaurant.name = name;
    if (logoUrl !== undefined) restaurant.logoUrl = logoUrl;
    if (websiteUrl !== undefined) restaurant.websiteUrl = websiteUrl;
    if (email !== undefined) restaurant.email = email;
    if (phoneNumber !== undefined) restaurant.phoneNumber = phoneNumber;
    if (branchCount !== undefined) restaurant.branchCount = branchCount;

    return this.restaurantRepository.save(restaurant);
  }
  async deleteRestaurant(restaurantId: number, user: User): Promise<Restaurant> {
    requireAdminRole(user, 'You do not have permission to delete restaurant.');

    const restaurant = await this.restaurantRepository.findOne({ where: { id: restaurantId } });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    await this.restaurantRepository.delete(restaurantId);
    return restaurant;
  }
  
}
