import {
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { BusinessService } from '../business/business.service';
import { GoogleAdsCampaignStatsDto } from './dto/google-ads-campaign-stats.dto';
import { GoogleAdsConnectionStatusDto } from './dto/google-ads-connection-status.dto';
import { GoogleAdsCustomerDto } from './dto/google-ads-customer.dto';
import { GoogleTagManagerContainerDto } from './dto/google-tag-manager-container.dto';
import { SetGoogleAdsCustomerDto } from './dto/set-google-ads-customer.dto';
import {
  GoogleCampaignDraftResumeResponseDto,
  SaveGoogleCampaignInfoStepResponseDto,
  SaveGoogleGoalDetailsStepResponseDto,
  SaveGoogleGoalStepResponseDto,
} from './dto/google-campaign-draft-response.dto';
import { SaveGoogleCampaignInfoStepDto } from './dto/save-google-campaign-info-step.dto';
import { SaveGoogleGoalDetailsStepDto } from './dto/save-google-goal-details-step.dto';
import { SaveGoogleGoalStepDto } from './dto/save-google-goal-step.dto';
import {
  GoogleCampaignStepSaveResponseDto,
  SaveGoogleAdsStepDto,
  SaveGoogleAudienceStepDto,
  SaveGoogleBudgetStepDto,
  SaveGoogleExtrasStepDto,
  SaveGoogleKeywordsStepDto,
  SaveGoogleLanguagesStepDto,
  SaveGoogleLocationsStepDto,
} from './dto/save-google-remaining-steps.dto';
import { PublishGoogleCampaignDraftDto } from './dto/publish-google-campaign-draft.dto';
import { UpdateGoogleDraftProgressDto } from './dto/update-google-draft-progress.dto';
import { GoogleAdsService } from './google-ads.service';
import { GoogleCampaignDraftService } from './google-campaign-draft.service';

function readIdempotencyKey(req: { headers?: Record<string, unknown> }): string | undefined {
  const raw = req.headers?.['idempotency-key'] ?? req.headers?.['Idempotency-Key'];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) {
    return raw[0].trim();
  }
  return undefined;
}

function readHttpErrorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const response = err.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    if (typeof response === 'object' && response && 'message' in response) {
      const message = (response as { message?: string | string[] }).message;
      if (Array.isArray(message)) {
        return message.join(' ');
      }
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return 'Google connection failed. Try again from Settings → Integrations.';
}

@Controller('google-ads')
export class GoogleAdsController {
  constructor(
    private readonly googleAdsService: GoogleAdsService,
    private readonly businessService: BusinessService,
    private readonly googleCampaignDraftService: GoogleCampaignDraftService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/goal-step')
  async saveGoalStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleGoalStepDto,
  ): Promise<SaveGoogleGoalStepResponseDto> {
    return this.googleCampaignDraftService.saveGoalStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/goal-details-step')
  async saveGoalDetailsStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleGoalDetailsStepDto,
  ): Promise<SaveGoogleGoalDetailsStepResponseDto> {
    return this.googleCampaignDraftService.saveGoalDetailsStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/campaign-info-step')
  async saveCampaignInfoStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleCampaignInfoStepDto,
  ): Promise<SaveGoogleCampaignInfoStepResponseDto> {
    return this.googleCampaignDraftService.saveCampaignInfoStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/budget-step')
  async saveBudgetStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleBudgetStepDto,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.googleCampaignDraftService.saveBudgetStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/locations-step')
  async saveLocationsStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleLocationsStepDto,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.googleCampaignDraftService.saveLocationsStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/languages-step')
  async saveLanguagesStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleLanguagesStepDto,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.googleCampaignDraftService.saveLanguagesStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/audience-step')
  async saveAudienceStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleAudienceStepDto,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.googleCampaignDraftService.saveAudienceStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/keywords-step')
  async saveKeywordsStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleKeywordsStepDto,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.googleCampaignDraftService.saveKeywordsStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/ads-step')
  async saveAdsStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleAdsStepDto,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.googleCampaignDraftService.saveAdsStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/extras-step')
  async saveExtrasStep(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SaveGoogleExtrasStepDto,
  ): Promise<GoogleCampaignStepSaveResponseDto> {
    return this.googleCampaignDraftService.saveExtrasStep(
      req.user,
      businessId,
      body,
      readIdempotencyKey(req),
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('business/:businessId/drafts/publish')
  async publishDraft(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: PublishGoogleCampaignDraftDto,
  ): Promise<{
    draftId: string;
    status: string;
    version: number;
    message: string;
  }> {
    return this.googleCampaignDraftService.publishDraft(
      req.user,
      businessId,
      body,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('business/:businessId/drafts/:draftId')
  async getDraft(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('draftId') draftId: string,
  ): Promise<GoogleCampaignDraftResumeResponseDto> {
    return this.googleCampaignDraftService.getDraft(
      req.user,
      businessId,
      draftId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Put('business/:businessId/drafts/:draftId/progress')
  async updateDraftProgress(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Param('draftId') draftId: string,
    @Body() body: UpdateGoogleDraftProgressDto,
  ): Promise<{
    id: string;
    currentStep: number;
    lastSavedAt: Date | null;
    version: number;
  }> {
    return this.googleCampaignDraftService.updateDraftProgress(
      req.user,
      businessId,
      draftId,
      body,
      readIdempotencyKey(req),
    );
  }

 @Get('callback/oauth')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('scope') scope: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const frontendBase = getFrontendBaseUrl();

    try {
      const result = await this.googleAdsService.handleOAuthCallback(
        code,
        state,
        error,
        errorDescription,
        scope,
      );

      return res.redirect(
        `${frontendBase}/google/select-customer?businessId=${result.businessId}`,
      );
    } catch (err) {
      const businessId =
        this.googleAdsService.parseBusinessIdFromOAuthState(state);
      const params = new URLSearchParams({
        error: readHttpErrorMessage(err),
      });
      if (businessId != null) {
        params.set('businessId', String(businessId));
      }

      return res.redirect(
        `${frontendBase}/google/select-customer?${params.toString()}`,
      );
    }
  } 

  @UseGuards(AuthGuard('jwt'))
  @Post('connect/:businessId')
  async connect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ url: string }> {
    return this.googleAdsService.connect(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('connect-abort/:businessId')
  async abortConnect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ restored: true }> {
    return this.googleAdsService.abortOAuthConnect(req.user, businessId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('status/:businessId')
  async status(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<GoogleAdsConnectionStatusDto> {
    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.googleAdsService.getConnectionStatus(business);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('ads/campaign-stats/:businessId')
  async adCampaignStats(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<GoogleAdsCampaignStatsDto> {
    const business = await this.businessService.findBusinessForUser(
      req.user,
      businessId,
    );

    if (!business) {
      throw new NotFoundException(
        'Business not found or you do not own this business.',
      );
    }

    return this.googleAdsService.getAdCampaignStats(business);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('customers/:businessId')
  async listCustomers(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<GoogleAdsCustomerDto[]> {
    return this.googleAdsService.listCustomersForBusiness(
      req.user,
      businessId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('gtm-containers/:businessId')
  async listGtmContainers(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<GoogleTagManagerContainerDto[]> {
    return this.googleAdsService.listGtmContainersForBusiness(
      req.user,
      businessId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('customer/:businessId')
  async setCustomer(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
    @Body() body: SetGoogleAdsCustomerDto,
  ): Promise<{ googleCustomerId: string }> {
    return this.googleAdsService.setBusinessCustomer(
      req.user,
      businessId,
      body.customerId,
      body.managerCustomerId,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('disconnect/:businessId')
  async disconnect(
    @Req() req,
    @Param('businessId', ParseIntPipe) businessId: number,
  ): Promise<{ disconnected: true }> {
    return this.googleAdsService.disconnectGoogleAdsForBusiness(
      req.user,
      businessId,
    );
  }
}

