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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { User } from '../../db/entities/user.entity';
import { CreateUserDto } from './userDto/create-user.dto';
import { UserService } from './user.service';
import { UpdateUserDto } from './userDto/update-user.dto';
import { UpdateProfileDto } from './userDto/update-profile.dto';
import {
  BUSINESS_LOGO_UPLOAD_MIMES,
  createUploadMulterOptions,
  sanitizeStoredUploadFileName,
  USERS_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';

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
  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadMulterOptions(USERS_UPLOAD_SUBDIR, {
        allowedMimeTypes: BUSINESS_LOGO_UPLOAD_MIMES,
        buildStoredFileName: (file) =>
          sanitizeStoredUploadFileName(file.originalname),
        fileFilterErrorMessage:
          'Only image files are allowed for the profile photo (PNG, JPEG, WebP, GIF).',
      }),
    ),
  )
  async updateOwnAvatar(
    @Req() req: { user: User },
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<User> {
    return this.userService.updateOwnAvatar(req.user.id, file);
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
  async updateUser(
    @Param('id') id: number,
    @Req() req,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<User> {
    const user = req.user;

    return this.userService.updateUser(id, updateUserDto, user);
  }
}
