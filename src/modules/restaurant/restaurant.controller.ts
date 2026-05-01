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
import { RestaurantService } from './restaurant.service';
import { AuthGuard } from '@nestjs/passport';
import { CreateRestaurantDto } from './restaurantDto/create-restaurant.dto';
import { Restaurant } from '../../db/entities/restaurant.entity';
import { UpdateRestaurantDto } from './restaurantDto/update-restaurant.dto';

@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly restaurantService: RestaurantService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  async createRestaurant(
    @Body() createRestaurantDto: CreateRestaurantDto,
    @Req() req,
  ): Promise<Restaurant> {
    const user = req.user;
    return this.restaurantService.createRestaurant(createRestaurantDto, user);
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
    @Param('id') id: number,
    @Req() req,
  ): Promise<Restaurant> {
    const user = req.user;
    return this.restaurantService.getRestaurantById(id, user);
  }
  @UseGuards(AuthGuard('jwt'))
  @Put(':id')
  async updateRestaurant(
    @Param('id') id: number,
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
  async deleteRestaurant(@Param('id') id: number, @Req() req): Promise<Restaurant> {
    const user = req.user;
    return this.restaurantService.deleteRestaurant(id, user);
  }
}
