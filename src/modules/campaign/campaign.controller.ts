import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import {
  createDiskFileUploadMulterOptions,
  CAMPAIGNS_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import { Campaign } from '../../db/entities/campaign.entity';
import { CreateCampaignDto } from './campaignDto/create-campaign.dto';
import { UpdateCampaignDto } from './campaignDto/update-campaign.dto';
import { CampaignService } from './campaign.service';

@Controller('campaign')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('create')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'image', maxCount: 1 },
      ],
      createDiskFileUploadMulterOptions(CAMPAIGNS_UPLOAD_SUBDIR, {
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
  createCampaign(
    @Body() createCampaignDto: CreateCampaignDto,
    @UploadedFiles()
    files: {
      file?: Express.Multer.File[];
      image?: Express.Multer.File[];
    },
  ): Promise<Campaign> {
    const uploaded = files?.file?.[0] ?? files?.image?.[0];
    return this.campaignService.createCampaign(createCampaignDto, uploaded);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('get-all')
  getAllCampaigns(): Promise<Campaign[]> {
    return this.campaignService.getAllCampaigns();
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('restaurant/:id')
  getCampaignsByRestaurant(
    @Param('id', ParseIntPipe) restaurantId: number,
  ): Promise<Campaign[]> {
    return this.campaignService.getCampaignsByRestaurantId(restaurantId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'image', maxCount: 1 },
      ],
      createDiskFileUploadMulterOptions(CAMPAIGNS_UPLOAD_SUBDIR, {
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
  updateCampaign(
    @Param('id', ParseIntPipe) campaignId: number,
    @Body() updateCampaignDto: UpdateCampaignDto,
    @UploadedFiles()
    files: {
      file?: Express.Multer.File[];
      image?: Express.Multer.File[];
    },
  ): Promise<Campaign> {
    const uploaded = files?.file?.[0] ?? files?.image?.[0];
    return this.campaignService.updateCampaign(
      campaignId,
      updateCampaignDto,
      uploaded,
    );
  }
}
