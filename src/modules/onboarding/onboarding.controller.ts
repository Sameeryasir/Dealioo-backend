import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import { OnboardingService } from './onboarding.service';
import { OnboardingStatusResponse } from './onboarding.types';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @UseGuards(JwtAuthGuard)
  @Get('status')
  getStatus(
    @Req() req: { user: { id: number; role: { name: string } } },
    @Query('restaurantId') restaurantIdRaw?: string,
  ): Promise<OnboardingStatusResponse> {
    let restaurantId: number | undefined;
    if (restaurantIdRaw != null && restaurantIdRaw.trim() !== '') {
      const parsed = parseInt(restaurantIdRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        restaurantId = undefined;
      } else {
        restaurantId = parsed;
      }
    }

    return this.onboardingService.getStatusForUser(
      req.user.id,
      req.user.role.name,
      restaurantId,
    );
  }
}
