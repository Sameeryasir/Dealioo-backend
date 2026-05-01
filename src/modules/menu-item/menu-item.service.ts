import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MenuItem } from '../../db/entities/menuItem.entity';
import { Menu } from '../../db/entities/menu.entity';
import { User } from '../../db/entities/user.entity';
import { requireAdminRole } from '../../utils/require-admin-role';
import { CreateMenuItemDto } from './menuItemDto/create-menuItem.dto';
import { UpdateMenuItemDto } from './menuItemDto/update-menuItem.dto';

@Injectable()
export class MenuItemService {
  constructor(
    @InjectRepository(MenuItem)
    private readonly menuItemRepository: Repository<MenuItem>,
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
  ) {}

  async createMenuItem(
    createMenuItemDto: CreateMenuItemDto,
    user: User,
  ): Promise<MenuItem> {
    requireAdminRole(user, 'You do not have permission to create a menu item.');
    const { menuId, name, description, price, imageUrl } = createMenuItemDto;
    const menu = await this.menuRepository.findOne({
      where: { id: menuId },
    });
    if (!menu) {
      throw new NotFoundException('Menu not found');
    }
    const menuItem = this.menuItemRepository.create({
      name,
      description,
      price: price != null ? String(price) : null,
      imageUrl: imageUrl ?? null,
      menu,
    });
    await this.menuItemRepository.save(menuItem);
    return menuItem;
  }
  async getMenuItemByMenuId(menuId: number): Promise<MenuItem[]> {
    const menuExists = await this.menuRepository.exist({
      where: { id: menuId },
    });
    if (!menuExists) {
      throw new NotFoundException('Menu not found');
    }
    return this.menuItemRepository.find({
      where: { menu: { id: menuId } },
    });
  }
  async getMenuItems(id: number): Promise<MenuItem> {
    const menuItem = await this.menuItemRepository.findOne({
      where: { id },
    });
    if (!menuItem) {
      throw new NotFoundException('Menu item not found');
    }
    return menuItem;
  }
  async updateMenuItem(
    id: number,
    updateMenuItemDto: UpdateMenuItemDto,
  ): Promise<MenuItem> {

    const menuItem = await this.menuItemRepository.findOne({
      where: { id },
    });
    if (!menuItem) {
      throw new NotFoundException('Menu item not found');
    }

    const { name, description, price, imageUrl } = updateMenuItemDto;

    if (name !== undefined) menuItem.name = name;
    if (description !== undefined) menuItem.description = description;
    if (price !== undefined) menuItem.price = String(price);
    if (imageUrl !== undefined) menuItem.imageUrl = imageUrl;

    return this.menuItemRepository.save(menuItem);
  }
  async deleteMenuItem(id: number): Promise<MenuItem> {
    const menuItem = await this.menuItemRepository.findOne({
      where: { id },
    });
    if (!menuItem) {
      throw new NotFoundException('Menu item not found');
    }
    await this.menuItemRepository.delete(id);
    return menuItem;
  }
}
