import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  createUploadMulterOptions,
  CAMPAIGNS_UPLOAD_SUBDIR,
} from '../../utils/disk-file-upload-multer';
import { Campaign } from '../../db/entities/campaign.entity';
import { CreateCampaignDto } from './campaignDto/create-campaign.dto';
import { UpdateCampaignDto } from './campaignDto/update-campaign.dto';
import { CampaignService } from './campaign.service';

type AuthRequest = Request & {
  user: {
    id: number;
    email?: string;
    role?: { name: string } | null;
  };
};

@Controller('campaign')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  /**
   * Change: Funnel/CRM editor hero image upload endpoint.
   * Why: Frontend TemplateEditorSidebar calls POST /campaign/upload-image.
   * Related: CampaignService.uploadCampaignImage, upload-campaign-image.ts
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor(
      'file',
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
  uploadImage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ imageUrl: string }> {
    return this.campaignService.uploadCampaignImage(file);
  }

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
    @Req() req: AuthRequest,
    @UploadedFiles()
    files: {
      file?: Express.Multer.File[];
      image?: Express.Multer.File[];
    },
  ): Promise<Campaign> {
    const uploaded = files?.file?.[0] ?? files?.image?.[0];
    return this.campaignService.createCampaign(
      createCampaignDto,
      req.user,
      uploaded,
    );
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
    @Req() req: AuthRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(6), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ): Promise<{ data: Campaign[]; meta: { page: number; limit: number; total: number; totalPages: number } }> {
    return this.campaignService.getCampaignsByBusinessId(
      businessId,
      req.user,
      page,
      limit,
      search,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  getCampaignById(
    @Param('id', ParseIntPipe) campaignId: number,
    @Req() req: AuthRequest,
  ): Promise<Campaign> {
    return this.campaignService.getCampaignById(campaignId, req.user);
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
    @Req() req: AuthRequest,
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
      req.user,
      uploaded,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  deleteCampaign(
    @Param('id', ParseIntPipe) campaignId: number,
    @Req() req: AuthRequest,
  ): Promise<{ deleted: true; campaignId: number }> {
    return this.campaignService.deleteCampaign(campaignId, req.user);
  }
}
