import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MenuItemService } from './menu-item.service';
import { AuthGuard } from '@nestjs/passport';
import { CreateMenuItemDto } from './menuItemDto/create-menuItem.dto';
import { MenuItem } from '../../db/entities/menuItem.entity';
import { UpdateMenuItemDto } from './menuItemDto/update-menuItem.dto';

@Controller('menu-item')
export class MenuItemController {
  constructor(private readonly menuItemService: MenuItemService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  async getAllMenuItems(@Param('id') id: number): Promise<MenuItem> {
    return this.menuItemService.getMenuItems(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  async createMenuItem(
    @Body() createMenuItemDto: CreateMenuItemDto,
    @Req() req,
  ): Promise<MenuItem> {
    const user = req.user;
    return this.menuItemService.createMenuItem(createMenuItemDto, user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('menu/:id')
  async getMenuItemByMenuId(@Param('id') id: number): Promise<MenuItem[]> {
    return this.menuItemService.getMenuItemByMenuId(id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Put(':id')
  async updateMenuItem(
    @Param('id') id: number,
    @Body() updateMenuItemDto: UpdateMenuItemDto,
    @Req() req,
  ): Promise<MenuItem> {
    const user = req.user;
    return this.menuItemService.updateMenuItem(id, updateMenuItemDto);
  }
  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  async deleteMenuItem(@Param('id') id: number, @Req() req): Promise<MenuItem> {
    const user = req.user;
    return this.menuItemService.deleteMenuItem(id);
  }
}
