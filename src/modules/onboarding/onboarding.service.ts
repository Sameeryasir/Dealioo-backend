import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Menu } from '../../db/entities/menu.entity';
import { Restaurant } from '../../db/entities/restaurant.entity';
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
    @InjectRepository(Restaurant)
    private readonly restaurantRepository: Repository<Restaurant>,
    @InjectRepository(Menu)
    private readonly menuRepository: Repository<Menu>,
  ) {}

  async getStatusForUser(
    userId: number,
    roleName: string,
    restaurantIdParam?: number,
  ): Promise<OnboardingStatusResponse> {
    const normalizedRole = roleName.trim();

    if (normalizedRole === SCANNER_ROLE) {
      return {
        restaurantId: null,
        twoFactorCompleted: true,
        restaurantCreated: true,
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

    const ownedRestaurants = await this.restaurantRepository.find({
      where: { owner: { id: userId } },
      order: { id: 'ASC' },
      select: {
        id: true,
        onboardingCompleted: true,
        onboardingCompletedAt: true,
      },
    });

    const restaurantCreated = ownedRestaurants.length > 0;

    let targetRestaurant = ownedRestaurants[0] ?? null;

    if (restaurantIdParam != null) {
      const match = ownedRestaurants.find((r) => r.id === restaurantIdParam);
      if (!match) {
        throw new BadRequestException(
          'Restaurant not found or you do not own this restaurant.',
        );
      }
      targetRestaurant = match;
    }

    // Menu upload is optional — onboarding completes once a business exists.
    for (const restaurant of ownedRestaurants) {
      if (!restaurant.onboardingCompleted) {
        await this.markRestaurantOnboardingComplete(restaurant.id);
      }
    }

    let menuCreated = false;
    if (targetRestaurant != null) {
      menuCreated = await this.restaurantHasMenu(targetRestaurant.id);
    }

    const nextStep = this.resolveNextStep({ restaurantCreated });

    const onboardingCompleted = restaurantCreated;

    const redirectRestaurantId =
      targetRestaurant?.id ?? ownedRestaurants[0]?.id ?? null;

    const redirectPath = this.buildRedirectPath(
      nextStep,
      redirectRestaurantId,
      onboardingCompleted,
    );

    return {
      restaurantId: targetRestaurant?.id ?? ownedRestaurants[0]?.id ?? null,
      twoFactorCompleted,
      restaurantCreated,
      menuCreated,
      onboardingCompleted,
      nextStep,
      redirectPath,
    };
  }

  async markMenuSetupComplete(restaurantId: number): Promise<void> {
    await this.markRestaurantOnboardingComplete(restaurantId);
  }

  async restaurantHasMenu(restaurantId: number): Promise<boolean> {
    const count = await this.menuRepository.count({
      where: { restaurant: { id: restaurantId } },
    });
    return count > 0;
  }

  private async markRestaurantOnboardingComplete(
    restaurantId: number,
  ): Promise<void> {
    await this.restaurantRepository.update(restaurantId, {
      onboardingCompleted: true,
      onboardingCompletedAt: new Date(),
    });
  }

  private resolveNextStep(input: {
    restaurantCreated: boolean;
  }): OnboardingNextStep {
    if (!input.restaurantCreated) {
      return 'restaurant_creation';
    }

    return null;
  }

  private buildRedirectPath(
    nextStep: OnboardingNextStep,
    restaurantId: number | null,
    onboardingCompleted: boolean,
  ): string {
    if (onboardingCompleted) {
      return '/dashboard';
    }

    switch (nextStep) {
      case 'restaurant_creation':
        return '/restaurant/register';
      case 'menu_setup':
        return restaurantId != null
          ? `/restaurant/upload-menu?restaurantId=${restaurantId}`
          : '/restaurant/upload-menu';
      default:
        return '/dashboard';
    }
  }
}
