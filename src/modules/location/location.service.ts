import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from '../../db/entities/location.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { CreateLocationDto } from './locationDto/create-location.dto';
import { UpdateLocationDto } from './locationDto/update-location.dto';

@Injectable()
export class LocationService {
  constructor(
    @InjectRepository(Location)
    private readonly locationRepository: Repository<Location>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
  ) {}

  async createLocation(
    createLocationDto: CreateLocationDto,
    user: User,
  ): Promise<Location> {
    requireAdminRole(
      user,
      'You do not have permission to create a location.',
    );

    const { businessId, name, address, city, state, country, postalCode } =
      createLocationDto;

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const location = this.locationRepository.create({
      business,
      name,
      address,
      city,
      state,
      country,
      postalCode,
    });

    await this.locationRepository.save(location);

    return location;
  }

  async updateLocation(
    locationId: number,
    updateLocationDto: UpdateLocationDto,
    user: User,
  ): Promise<Location> {
    requireAdminRole(user, 'You do not have permission to update location.');

    const location = await this.locationRepository.findOne({
      where: { id: locationId },
    });
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    const {
      name,
      address,
      city,
      state,
      country,
      postalCode,
    } = updateLocationDto;

    if (name !== undefined) location.name = name;
    if (address !== undefined) location.address = address;
    if (city !== undefined) location.city = city;
    if (state !== undefined) location.state = state;
    if (country !== undefined) location.country = country;
    if (postalCode !== undefined) location.postalCode = postalCode;

    return this.locationRepository.save(location);
  }
  
  async deleteLocation(locationId: number, user: User): Promise<Location> {
    requireAdminRole(user, 'You do not have permission to delete location.');
    const location = await this.locationRepository.findOne({ where: { id: locationId } });
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    await this.locationRepository.delete(locationId);
    return location;
  }
}
