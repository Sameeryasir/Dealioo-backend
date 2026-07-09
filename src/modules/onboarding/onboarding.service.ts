import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Menu } from '../../db/entities/menu.entity';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import {
  OnboardingNextStep,
  OnboardingStatusResponse,
} from './onboarding.types';

const ADMIN_ROLE = 'Admin';
const SCANNER_ROLE = 'Scanner';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
  ) {}

  async getStatusForUser(
    userId: number,
    roleName: string,
    businessIdParam?: number,
  ): Promise<OnboardingStatusResponse> {
    const normalizedRole = roleName.trim();

    if (normalizedRole === SCANNER_ROLE) {
      return {
        businessId: null,
        twoFactorCompleted: true,
        businessCreated: true,
        menuCreated: true,
        onboardingCompleted: true,
        nextStep: null,
        redirectPath: '/dashboard',
      };
    }

    if (normalizedRole !== ADMIN_ROLE) {
      throw new ForbiddenException(
        'Onboarding status is only available for admin accounts.',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const twoFactorCompleted = true;

    const ownedBusinesses = await this.businessRepository.find({
      where: { owner: { id: userId } },
      order: { id: 'ASC' },
      select: {
        id: true,
        onboardingCompleted: true,
        onboardingCompletedAt: true,
      },
    });

    const businessCreated = ownedBusinesses.length > 0;

    let targetBusiness = ownedBusinesses[0] ?? null;

    if (businessIdParam != null) {
      const match = ownedBusinesses.find((r) => r.id === businessIdParam);
      if (!match) {
        throw new BadRequestException(
          'Business not found or you do not own this business.',
        );
      }
      targetBusiness = match;
    }

    for (const business of ownedBusinesses) {
      if (!business.onboardingCompleted) {
        await this.markBusinessOnboardingComplete(business.id);
      }
    }

    let menuCreated = false;
    if (targetBusiness != null) {
      menuCreated = await this.businessHasMenu(targetBusiness.id);
    }

    const nextStep = this.resolveNextStep({ businessCreated });

    const onboardingCompleted = businessCreated;

    const redirectBusinessId =
      targetBusiness?.id ?? ownedBusinesses[0]?.id ?? null;

    const redirectPath = this.buildRedirectPath(
      nextStep,
      redirectBusinessId,
      onboardingCompleted,
    );

    return {
      businessId: targetBusiness?.id ?? ownedBusinesses[0]?.id ?? null,
      twoFactorCompleted,
      businessCreated,
      menuCreated,
      onboardingCompleted,
      nextStep,
      redirectPath,
    };
  }

  async markMenuSetupComplete(businessId: number): Promise<void> {
    await this.markBusinessOnboardingComplete(businessId);
  }

  async businessHasMenu(businessId: number): Promise<boolean> {
    const count = await this.menuRepository.count({
      where: { business: { id: businessId } },
    });
    return count > 0;
  }

  private async markBusinessOnboardingComplete(
    businessId: number,
  ): Promise<void> {
    await this.businessRepository.update(businessId, {
      onboardingCompleted: true,
      onboardingCompletedAt: new Date(),
    });
  }

  private resolveNextStep(input: {
    businessCreated: boolean;
  }): OnboardingNextStep {
    if (!input.businessCreated) {
      return 'business_creation';
    }

    return null;
  }

  private buildRedirectPath(
    nextStep: OnboardingNextStep,
    businessId: number | null,
    onboardingCompleted: boolean,
  ): string {
    if (onboardingCompleted) {
      return '/dashboard';
    }

    switch (nextStep) {
      case 'business_creation':
        return '/business/register';
      case 'menu_setup':
        return businessId != null
          ? `/business/upload-menu?businessId=${businessId}`
          : '/business/upload-menu';
      default:
        return '/dashboard';
    }
  }
}
