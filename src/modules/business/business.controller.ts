import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BusinessService } from './business.service';
import { AuthGuard } from '@nestjs/passport';
import { CreateBusinessDto } from './businessDto/create-business.dto';
import { Business } from '../../db/entities/business.entity';
import { UpdateBusinessDto } from './businessDto/update-business.dto';
import {
  buildBusinessLogoFileName,
  createUploadMulterOptions,
  BUSINESS_LOGO_UPLOAD_MIMES,
  BUSINESSES_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import type { Request } from 'express';
import { User } from '../../db/entities/user.entity';

@Controller('business')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadMulterOptions(BUSINESSES_UPLOAD_SUBDIR, {
        allowedMimeTypes: BUSINESS_LOGO_UPLOAD_MIMES,
        buildStoredFileName: (file) =>
          buildBusinessLogoFileName(file.originalname),
        fileFilterErrorMessage:
          'Only image files are allowed for the business logo (PNG, JPEG, WebP, GIF).',
      }),
    ),
  )
  async createBusiness(
    @Body() createBusinessDto: CreateBusinessDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request & { user: User },
  ): Promise<Business> {
    const user = req.user;
    return this.businessService.createBusiness(
      createBusinessDto,
      user,
      file,
    );
  }
  @UseGuards(AuthGuard('jwt'))
  @Get('all')
  async getAllBusinesses(
    @Req() req,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(8), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ): Promise<{ data: Business[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
    const user = req.user;
    return this.businessService.getAllBusinesses(user, page, limit, search);
  }
  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  async getBusinessById(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<Business> {
    const user = req.user;
    return this.businessService.getBusinessById(id, user);
  }
  @UseGuards(AuthGuard('jwt'))
  @Put(':id')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadMulterOptions(BUSINESSES_UPLOAD_SUBDIR, {
        allowedMimeTypes: BUSINESS_LOGO_UPLOAD_MIMES,
        buildStoredFileName: (file) =>
          buildBusinessLogoFileName(file.originalname),
        fileFilterErrorMessage:
          'Only image files are allowed for the business logo (PNG, JPEG, WebP, GIF).',
      }),
    ),
  )
  async updateBusiness(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBusinessDto: UpdateBusinessDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req,
  ): Promise<Business> {
    const user = req.user;
    return this.businessService.updateBusiness(
      id,
      updateBusinessDto,
      user,
      file,
    );
  }
  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  async deleteBusiness(
    @Param('id', ParseIntPipe) id: number,
    @Req() req,
  ): Promise<Business> {
    const user = req.user;
    return this.businessService.deleteBusiness(id, user);
  }
}
