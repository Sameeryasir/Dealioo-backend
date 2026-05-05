import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import {
  createDiskFileUploadMulterOptions,
  FUNNELS_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import { Funnel } from '../../db/entities/funnel.entity';
import { CreateFunnelDto } from './funnelDto/create-funnel.dto';
import { FunnelService } from './funnel.service';

@Controller('funnel')
export class FunnelController {
  constructor(private readonly funnelService: FunnelService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createDiskFileUploadMulterOptions(FUNNELS_UPLOAD_SUBDIR, {
        allowedMimeTypes: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/gif',
        ],
        fileFilterErrorMessage:
          'Only image files are allowed (PNG, JPEG, WebP, GIF).',
      }),
    ),
  )
  createFunnel(
    @Body() createFunnelDto: CreateFunnelDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<Funnel> {
    return this.funnelService.createFunnel(createFunnelDto, file);
  }
  @UseGuards(AuthGuard('jwt'))
  @Get('get-all')
  getAllFunnels(): Promise<Funnel[]> {
    return this.funnelService.getAllFunnels();
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:id')
  getFunnelsByRestaurant(
    @Param('id', ParseIntPipe) restaurantId: number,
  ): Promise<Funnel[]> {
    return this.funnelService.getFunnelsByRestaurantId(restaurantId);
  }
}
