import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { CreateRestaurantDto } from './restaurantDto/create-restaurant.dto';
import { UpdateRestaurantDto } from './restaurantDto/update-restaurant.dto';
import {
  publicUploadFileUrl,
  RESTAURANTS_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';

@Injectable()
export class RestaurantService {
  constructor(
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

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
      ? publicUploadFileUrl(RESTAURANTS_UPLOAD_SUBDIR, file.filename)
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
  async getAllRestaurants(user: User): Promise<Restaurant[]> {
    requireAdminRole(
      user,
      'You do not have permission to get all restaurants.',
    );

    return this.restaurantRepository.find({
      where: { owner: { id: user.id } },
    });
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
