import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Menu } from 'src/db/entities/menu.entity';
import { Repository } from 'typeorm';
import { CreateMenuDto } from './menuDto/create-menu.dto';
import { requireAdminRole } from 'src/utils/require-admin-role';
import { User } from 'src/db/entities/user.entity';
import { Restaurant } from 'src/db/entities/restaurant.entity';

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
  ) {}

  async createMenu(createMenuDto: CreateMenuDto, user: User): Promise<Menu> {
    requireAdminRole(user, 'You do not have permission to create menu.');
    const { restaurantId, fileUrl } = createMenuDto;
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    const menu = this.menuRepository.create({
      restaurant,
      fileUrl,
    });
    await this.menuRepository.save(menu);
    return menu;
  }
  async getAllMenus(user: User): Promise<Menu[]> {
    requireAdminRole(user, 'You do not have permission to get all menus.');
    return this.menuRepository.find({
      where: { restaurant: { owner: { id: user.id } } },
    });
  }
  async getMenuByRestaurantId(
    restaurantId: number,
    user: User,
  ): Promise<Menu[]> {
    requireAdminRole(
      user,
      'You do not have permission to see this menu.',
    );
    return this.menuRepository.find({
      where: { restaurant: { id: restaurantId } },
    });
  }
}
