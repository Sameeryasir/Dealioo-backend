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
import { Business } from 'src/db/entities/business.entity';
import { OnboardingService } from '../onboarding/onboarding.service';

@Injectable()
export class MenuService {
  constructor(
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
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
      businessId,
      name,
      description,
      menuType,
      fileUrl: dtoFileUrl,
    } = createMenuDto;
    const business = await this.businessRepository.findOne({
      where: { id: businessId, owner: { id: user.id } },
    });
    if (!business) {
      throw new NotFoundException('Business not found');
    }

    const existingMenuCount = await this.menuRepository.count({
      where: { business: { id: businessId } },
    });
    if (existingMenuCount > 0) {
      throw new ConflictException(
        'This business already has a menu. Onboarding menu setup is complete.',
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
      business,
      name,
      description,
      menuType,
      fileUrl,
      fileName,
      fileSize,
    });
    await this.menuRepository.save(menu);
    await this.onboardingService.markMenuSetupComplete(businessId);
    return menu;
  }
  async getAllMenus(user: User): Promise<Menu[]> {
    requireAdminRole(user, 'You do not have permission to get all menus.');
    return this.menuRepository.find({
      where: { business: { owner: { id: user.id } } },
    });
  }
  async getMenuByBusinessId(
    businessId: number,
    user: User,
  ): Promise<Menu[]> {
    requireAdminRole(user, 'You do not have permission to see this menu.');
    return this.menuRepository.find({
      where: { business: { id: businessId } },
    });
  }
}
