import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MenuItem } from '../../db/entities/menuItem.entity';
import { Menu } from '../../db/entities/menu.entity';
import { AuthModule } from '../auth/auth.module';
import { MenuItemController } from './menu-item.controller';
import { MenuItemService } from './menu-item.service';

@Module({
  imports: [TypeOrmModule.forFeature([MenuItem, Menu]), AuthModule],
  providers: [MenuItemService],
  controllers: [MenuItemController],
})
export class MenuItemModule {}
