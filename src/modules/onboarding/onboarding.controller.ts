import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import {
  GetPlanFitResult,
  OnboardingService,
  SavePlanFitResult,
} from './onboarding.service';
import {
  BusinessOnboardingDraftResponse,
  OnboardingStatusResponse,
} from './onboarding.types';
import { SavePlanFitDto } from './onboardingDto/save-plan-fit.dto';
import { SavePlanFitProgressDto } from './onboardingDto/save-plan-fit-progress.dto';
import { UpsertBusinessDraftDto } from './onboardingDto/upsert-business-draft.dto';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus(
    @Req() req: { user: { id: number; role: { name: string } } },
    @Query('businessId') businessIdRaw?: string,
  ): Promise<OnboardingStatusResponse> {
    let businessId: number | undefined;
    if (businessIdRaw != null && businessIdRaw.trim() !== '') {
      const parsed = parseInt(businessIdRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        businessId = undefined;
      } else {
        businessId = parsed;
      }
    }

    return this.onboardingService.getStatusForUser(
      req.user.id,
      req.user.role.name,
      businessId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('plan-fit')
  getPlanFit(
    @Req() req: { user: { id: number } },
  ): Promise<GetPlanFitResult> {
    return this.onboardingService.getPlanFit(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('plan-fit')
  savePlanFit(
    @Req() req: { user: { id: number } },
    @Body() dto: SavePlanFitDto,
  ): Promise<SavePlanFitResult> {
    return this.onboardingService.savePlanFit(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Put('plan-fit/progress')
  savePlanFitProgress(
    @Req() req: { user: { id: number } },
    @Body() dto: SavePlanFitProgressDto,
  ) {
    return this.onboardingService.savePlanFitProgress(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('business-draft')
  getBusinessDraft(
    @Req() req: { user: { id: number } },
  ): Promise<BusinessOnboardingDraftResponse | null> {
    return this.onboardingService.getBusinessDraft(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('business-draft')
  upsertBusinessDraft(
    @Req() req: { user: { id: number } },
    @Body() dto: UpsertBusinessDraftDto,
  ): Promise<BusinessOnboardingDraftResponse> {
    return this.onboardingService.upsertBusinessDraft(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('business-draft')
  async deleteBusinessDraft(
    @Req() req: { user: { id: number } },
  ): Promise<{ success: true }> {
    await this.onboardingService.deleteBusinessDraft(req.user.id);
    return { success: true };
  }
}
