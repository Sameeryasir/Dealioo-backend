import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import {
  ADMIN_ROLE,
  MANAGER_ROLE,
  MEMBER_ROLE,
  STAFF_ROLE,
  SUPER_ADMIN_ROLE,
} from '../../utils/user-roles';

type AuthUser = {
  id: number;
  role?: { name?: string } | null;
};

@Injectable()
export class RequireActiveSubscriptionGuard implements CanActivate {
  constructor(
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user?.id) {
      throw new UnauthorizedException();
    }

    const role = user.role?.name?.trim() ?? '';
    if (role === SUPER_ADMIN_ROLE) {
      return true;
    }
    if (
      role === MANAGER_ROLE ||
      role === STAFF_ROLE ||
      role === MEMBER_ROLE
    ) {
      return true;
    }
    if (role !== ADMIN_ROLE) {
      return true;
    }

    const paid = await this.subscriptionRepository.count({
      where: {
        userId: user.id,
        status: In(['active', 'trialing']),
      },
    });
    if (paid < 1) {
      throw new ForbiddenException(
        'An active subscription is required before you can continue.',
      );
    }

    return true;
  }
}
