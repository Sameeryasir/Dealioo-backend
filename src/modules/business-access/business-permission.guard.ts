import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { BusinessMemberPermission } from '../member/member.constants';
import { BusinessAccessService } from './business-access.service';
import { BUSINESS_PERMISSION_KEY } from './business-permission.decorator';

@Injectable()
export class BusinessPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<BusinessMemberPermission>(
      BUSINESS_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { id: number; email?: string; role?: { name: string } | null };
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      query?: Record<string, unknown>;
    }>();

    const user = request.user;
    if (!user?.id) {
      return false;
    }

    const businessId = this.resolveBusinessId(request);
    if (businessId == null) {
      throw new BadRequestException('Business id is required.');
    }

    await this.businessAccessService.assertPermission(
      user,
      businessId,
      permission,
    );
    return true;
  }

  private resolveBusinessId(request: {
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    query?: Record<string, unknown>;
  }): number | null {
    const candidates = [
      request.params?.businessId,
      request.params?.id,
      request.body?.businessId,
      request.query?.businessId,
    ];

    for (const value of candidates) {
      const parsed =
        typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? Number.parseInt(value, 10)
            : NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return null;
  }
}
