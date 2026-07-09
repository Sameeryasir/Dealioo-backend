import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  createUploadMulterOptions,
  MENUS_UPLOAD_SUBDIR,
} from 'src/utils/disk-file-upload-multer';
import { MenuService } from './menu.service';
import { Menu } from 'src/db/entities/menu.entity';
import { CreateMenuDto } from './menuDto/create-menu.dto';
import { User } from 'src/db/entities/user.entity';

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadMulterOptions(MENUS_UPLOAD_SUBDIR),
    ),
  )
  async createMenu(
    @Body() createMenuDto: CreateMenuDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request & { user: User },
  ): Promise<Menu> {
    const user = req.user;
    return this.menuService.createMenu(createMenuDto, user, file);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('all')
  async getAllMenus(@Req() req: Request & { user: User }): Promise<Menu[]> {
    const user = req.user;
    return this.menuService.getAllMenus(user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:id')
  async getMenuByBusinessId(
    @Param('id') id: number,
    @Req() req: Request & { user: User },
  ): Promise<Menu[]> {
    const user = req.user;
    return this.menuService.getMenuByBusinessId(id, user);
  }
}
