import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import {
  GetPlanFitResult,
  OnboardingService,
  SavePlanFitResult,
} from './onboarding.service';
import { OnboardingStatusResponse } from './onboarding.types';
import { SavePlanFitDto } from './onboardingDto/save-plan-fit.dto';

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
}
