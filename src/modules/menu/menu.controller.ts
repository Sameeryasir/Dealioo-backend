import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { MenuService } from './menu.service';
import { AuthGuard } from '@nestjs/passport';
import { Menu } from 'src/db/entities/menu.entity';
import { CreateMenuDto } from './menuDto/create-menu.dto';

@Controller('menu')
export class MenuController {
    constructor(private readonly menuService: MenuService) {}

    @UseGuards(AuthGuard('jwt'))
    @Post('create')
    async createMenu(@Body() createMenuDto: CreateMenuDto, @Req() req): Promise<Menu> {
        const user = req.user;
        return this.menuService.createMenu(createMenuDto, user);
    }
    @UseGuards(AuthGuard('jwt'))
    @Get('all')
    async getAllMenus(@Req() req): Promise<Menu[]> {
        const user = req.user;
        return this.menuService.getAllMenus(user);
    }
    @UseGuards(AuthGuard('jwt'))
    @Get('restaurant/:id')
    async getMenuByRestaurantId(@Param('id') id: number, @Req() req): Promise<Menu[]> {
        const user = req.user;
        return this.menuService.getMenuByRestaurantId(id, user);
    }
}
