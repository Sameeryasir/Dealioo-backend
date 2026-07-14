import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { FacebookCampaign } from '../../db/entities/facebook-campaign.entity';
import {
  CAMPAIGNS_UPLOAD_SUBDIR,
  createUploadMulterOptions,
} from '../../utils/disk-file-upload-multer';
import { CreateFacebookCampaignDto } from './dto/create-facebook-campaign.dto';
import { CreateFacebookCampaignResponseDto } from './dto/create-facebook-campaign-response.dto';
import { MetaCampaignDraftResponseDto } from './dto/meta-campaign-draft-response.dto';
import { SaveAdCreativeStepDto } from './dto/save-ad-creative-step.dto';
import { SaveAdSetStepDto } from './dto/save-adset-step.dto';
import { SaveCampaignStepDto } from './dto/save-campaign-step.dto';
import { FacebookCampaignService } from './facebook-campaign.service';
import { MetaCampaignDraftService } from './meta-campaign-draft.service';
import { MetaPublishService } from './meta-publish.service';
import { PublishMetaCampaignResponseDto } from './dto/publish-meta-campaign-response.dto';

@Controller('facebook-campaigns')
export class FacebookCampaignController {
  constructor(
    private readonly facebookCampaignService: FacebookCampaignService,
    private readonly metaCampaignDraftService: MetaCampaignDraftService,
    private readonly metaPublishService: MetaPublishService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/ad-creative-step')
  async saveAdCreativeStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveAdCreativeStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {
    return this.metaCampaignDraftService.saveAdCreativeStep(
      req.user,
      businessId,
      body,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/adset-step')
  async saveAdSetStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveAdSetStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {
    return this.metaCampaignDraftService.saveAdSetStep(
      req.user,
      businessId,
      body,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/campaign-step')
  async saveCampaignStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveCampaignStepDto,
  ): Promise<MetaCampaignDraftResponseDto> {
    return this.metaCampaignDraftService.saveCampaignStep(
      req.user,
      businessId,
      body,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/drafts')
  async listDrafts(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<MetaCampaignDraftResponseDto[]> {
    return this.metaCampaignDraftService.listDrafts(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/drafts/:draftId')
  async getDraft(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('draftId') draftId: string,
  ): Promise<MetaCampaignDraftResponseDto> {
    return this.metaCampaignDraftService.getDraft(
      req.user,
      businessId,
      draftId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/:draftId/publish')
  async publishDraft(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('draftId') draftId: string,
  ): Promise<PublishMetaCampaignResponseDto> {
    return this.metaPublishService.publishFullCampaign(
      req.user,
      businessId,
      draftId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/ad-image')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadMulterOptions(CAMPAIGNS_UPLOAD_SUBDIR, {
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        fileFilterErrorMessage:
          'Only image files are allowed (PNG, JPEG, WebP, GIF).',
      }),
    ),
  )
  async uploadAdImage(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ imageUrl: string; imageHash: string }> {
    return this.facebookCampaignService.uploadAdImageForBusiness(
      req.user,
      businessId,
      file,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/ad-video')
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadMulterOptions(CAMPAIGNS_UPLOAD_SUBDIR, {
        allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
        maxFileBytes: 50 * 1024 * 1024,
        fileFilterErrorMessage:
          'Only video files are allowed (MP4, MOV, WebM).',
      }),
    ),
  )
  async uploadAdVideo(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ videoUrl: string }> {
    return this.facebookCampaignService.uploadAdVideoForBusiness(
      req.user,
      businessId,
      file,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId')
  async create(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: CreateFacebookCampaignDto,
  ): Promise<CreateFacebookCampaignResponseDto> {
    return this.facebookCampaignService.createForBusiness(
      req.user,
      businessId,
      body,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('business/:businessId/meta/:metaCampaignId')
  async deleteMetaCampaign(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('metaCampaignId') metaCampaignId: string,
  ): Promise<{ deleted: true; metaCampaignId: string }> {
    return this.facebookCampaignService.deleteMetaCampaignForBusiness(
      req.user,
      businessId,
      metaCampaignId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId')
  async list(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<FacebookCampaign[]> {
    return this.facebookCampaignService.listForBusiness(
      req.user,
      businessId,
    );
  }
}
