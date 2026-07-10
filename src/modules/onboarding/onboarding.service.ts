import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscriptionsService } from '../user-subscriptions/user-subscriptions.service';
import {
  OnboardingNextStep,
  OnboardingStatusResponse,
} from './onboarding.types';
import { SCANNER_ROLE, SUPER_ADMIN_ROLE, ADMIN_ROLE } from '../../utils/user-roles';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    private readonly userSubscriptionsService: UserSubscriptionsService,
  ) {}

  async getStatusForUser(
    userId: number,
    roleName: string,
    businessIdParam?: number,
  ): Promise<OnboardingStatusResponse> {
    const normalizedRole = roleName.trim();

    if (normalizedRole === SCANNER_ROLE || normalizedRole === SUPER_ADMIN_ROLE) {
      return {
        businessId: null,
        twoFactorCompleted: true,
        subscriptionSelected: true,
        businessCreated: true,
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
    const subscriptionSelected =
      await this.userSubscriptionsService.userHasActiveSubscription(userId);

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

    const nextStep = this.resolveNextStep({
      subscriptionSelected,
      businessCreated,
    });
    const onboardingCompleted = subscriptionSelected && businessCreated;

    const redirectPath = this.buildRedirectPath(
      nextStep,
      onboardingCompleted,
    );

    return {
      businessId: targetBusiness?.id ?? ownedBusinesses[0]?.id ?? null,
      twoFactorCompleted,
      subscriptionSelected,
      businessCreated,
      onboardingCompleted,
      nextStep,
      redirectPath,
    };
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
    subscriptionSelected: boolean;
    businessCreated: boolean;
  }): OnboardingNextStep {
    if (!input.subscriptionSelected) {
      return 'plan_selection';
    }

    if (!input.businessCreated) {
      return 'business_creation';
    }

    return null;
  }

  private buildRedirectPath(
    nextStep: OnboardingNextStep,
    onboardingCompleted: boolean,
  ): string {
    if (onboardingCompleted) {
      return '/dashboard';
    }

    if (nextStep === 'plan_selection') {
      return '/auth/select-plan';
    }

    if (nextStep === 'business_creation') {
      return '/business/register';
    }

    return '/dashboard';
  }
}
