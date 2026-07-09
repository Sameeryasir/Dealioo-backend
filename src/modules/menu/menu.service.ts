import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Menu } from 'src/db/entities/menu.entity';
import { Repository } from 'typeorm';
import { CreateMenuDto } from './menuDto/create-menu.dto';
import { requireAdminRole } from 'src/utils/require-admin-role';
import {
  MENUS_UPLOAD_SUBDIR,
} from 'src/utils/disk-file-upload-multer';
import { persistUploadedFile } from 'src/utils/persist-uploaded-file';
import { SpacesService } from '../spaces/spaces.service';
import { User } from 'src/db/entities/user.entity';
import { Restaurant } from 'src/db/entities/restaurant.entity';
import { OnboardingService } from '../onboarding/onboarding.service';

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    private readonly onboardingService: OnboardingService,
    private readonly spacesService: SpacesService,
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
      where: { id: restaurantId, owner: { id: user.id } },
    });
    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const existingMenuCount = await this.menuRepository.count({
      where: { restaurant: { id: restaurantId } },
    });
    if (existingMenuCount > 0) {
      throw new ConflictException(
        'This restaurant already has a menu. Onboarding menu setup is complete.',
      );
    }
    const fileUrl = file
      ? await persistUploadedFile(
          this.spacesService,
          file,
          MENUS_UPLOAD_SUBDIR,
        )
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
    await this.onboardingService.markMenuSetupComplete(restaurantId);
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
