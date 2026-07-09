import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Menu } from '../../db/entities/menu.entity';
import { Business } from '../../db/entities/business.entity';
import { AuthModule } from '../auth/auth.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
  imports: [TypeOrmModule.forFeature([Menu, Business]), AuthModule, OnboardingModule],
  providers: [MenuService],
  controllers: [MenuController],
})
export class MenuModule {}
