import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Menu } from 'src/db/entities/menu.entity';
import { Repository } from 'typeorm';
import { CreateMenuDto } from './menuDto/create-menu.dto';
import { requireAdminRole } from 'src/utils/require-admin-role';
import {
  MENUS_UPLOAD_SUBDIR,
  publicUploadFileUrl,
} from 'src/utils/disk-file-upload-multer';
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

  async createMenu(
    createMenuDto: CreateMenuDto,
    user: User,
    file?: Express.Multer.File,
  ): Promise<Menu> {
    requireAdminRole(user, 'You do not have permission to create menu.');
    const {
      restaurantId,
      name,
      description,
      menuType,
      fileUrl: dtoFileUrl,
    } = createMenuDto;
    const restaurant = await this.restaurantRepository.findOne({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }
    const fileUrl = file
      ? publicUploadFileUrl(MENUS_UPLOAD_SUBDIR, file.filename)
      : (dtoFileUrl ?? null);
    const fileName = file?.originalname ?? null;
    const fileSize = file?.size ?? null;
    const menu = this.menuRepository.create({
      restaurant,
      name,
      description,
      menuType,
      fileUrl,
      fileName,
      fileSize,
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
    requireAdminRole(user, 'You do not have permission to see this menu.');
    return this.menuRepository.find({
      where: { restaurant: { id: restaurantId } },
    });
  }
}
