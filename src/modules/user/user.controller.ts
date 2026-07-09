import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '../../db/entities/user.entity';
import { CreateUserDto } from './userDto/create-user.dto';
import { UserService } from './user.service';
import { UpdateUserDto } from './userDto/update-user.dto';
import { UpdateProfileDto } from './userDto/update-profile.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getOwnProfile(@Req() req: { user: User }): Promise<User> {
    return this.userService.getOwnProfile(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('me')
  async updateOwnProfile(
    @Req() req: { user: User },
    @Body() updateProfileDto: UpdateProfileDto,
  ): Promise<User> {
    return this.userService.updateOwnProfile(req.user.id, updateProfileDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('all')
  async getAllUsers(@Req() req): Promise<User[]> {
    const user = req.user;
    return this.userService.getAllUsers(user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  async createUser(
    @Body() createUserDto: CreateUserDto,
    @Req() req,
  ): Promise<User> {
    const user = req.user;
    return this.userService.createUser(createUserDto, user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  async deleteUser(@Param('id') id: number): Promise<User> {
    return this.userService.deleteUser(id);
  }
  @UseGuards(AuthGuard('jwt'))
  @Patch('deactivate/:id')
  async deactivateUser(@Param('id') id: number, @Req() req): Promise<User> {
    const user = req.user;

    return this.userService.deactivateUser(id, user);
  }
  @UseGuards(AuthGuard('jwt'))
  @Patch('activate/:id')
  async activateUser(@Param('id') id: number, @Req() req): Promise<User> {
    const user = req.user;

    return this.userService.activateUser(id, user);
  }
  
  @UseGuards(AuthGuard('jwt'))
  @Put(':id')
  async updateUser(@Param('id') id: number, @Req() req, @Body() updateUserDto: UpdateUserDto): Promise<User> {
    const user = req.user;

    return this.userService.updateUser(id, updateUserDto, user);
  }
}
