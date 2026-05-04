import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RestaurantService } from './restaurant.service';
import { AuthGuard } from '@nestjs/passport';
import { CreateRestaurantDto } from './restaurantDto/create-restaurant.dto';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { UpdateRestaurantDto } from './restaurantDto/update-restaurant.dto';
import {
  createDiskFileUploadMulterOptions,
  RESTAURANTS_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import type { Request } from 'express';
import { User } from '../../db/entities/user.entity';

@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly restaurantService: RestaurantService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createDiskFileUploadMulterOptions(RESTAURANTS_UPLOAD_SUBDIR),
    ),
  )
  async createRestaurant(
    @Body() createRestaurantDto: CreateRestaurantDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request & { user: User },
  ): Promise<Restaurant> {
    const user = req.user;
    return this.restaurantService.createRestaurant(
      createRestaurantDto,
      user,
      file,
    );
  }
  @UseGuards(AuthGuard('jwt'))
  @Get('all')
  async getAllRestaurants(@Req() req): Promise<Restaurant[]> {
    const user = req.user;
    return this.restaurantService.getAllRestaurants(user);
  }
  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  async getRestaurantById(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<Restaurant> {
    const user = req.user;
    return this.restaurantService.getRestaurantById(id, user);
  }
  @UseGuards(AuthGuard('jwt'))
  @Put(':id')
  async updateRestaurant(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRestaurantDto: UpdateRestaurantDto,
    @Req() req,
  ): Promise<Restaurant> {
    const user = req.user;
    return this.restaurantService.updateRestaurant(
      id,
      updateRestaurantDto,
      user,
    );
  }
  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  async deleteRestaurant(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<Restaurant> {
    const user = req.user;
    return this.restaurantService.deleteRestaurant(id, user);
  }
}
