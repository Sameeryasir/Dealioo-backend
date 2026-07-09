import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import {
  createUploadMulterOptions,
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
      createUploadMulterOptions(CAMPAIGNS_UPLOAD_SUBDIR, {
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
  @Get('business/:id')
  getCampaignsByBusiness(
    @Param('id', ParseIntPipe) businessId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(6), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ): Promise<{ data: Campaign[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
    return this.campaignService.getCampaignsByBusinessId(
      businessId,
      page,
      limit,
      search,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  getCampaignById(
    @Param('id', ParseIntPipe) campaignId: number,
  ): Promise<Campaign> {
    return this.campaignService.getCampaignById(campaignId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'image', maxCount: 1 },
      ],
      createUploadMulterOptions(CAMPAIGNS_UPLOAD_SUBDIR, {
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
