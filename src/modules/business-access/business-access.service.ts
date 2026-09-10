import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import {
  ALL_BUSINESS_MEMBER_PERMISSIONS,
  type BusinessMemberPermission as BusinessMemberPermissionKey,
} from '../member/member.constants';
import { BUSINESS_MEMBER_STATUS } from '../member/business-member-status';
import { isSuperAdmin } from '../../utils/user-roles';
import { BusinessMembershipCacheService } from './business-membership-cache.service';

export type BusinessAccessUser = {
  id: number;
  email?: string;
  role?: { name: string } | null;
};

export type BusinessAccessContext = {
  access: 'owner' | 'member' | 'super_admin';
  role: string;
  permissions: BusinessMemberPermissionKey[];
  businessId: number;
};

@Injectable()
export class BusinessAccessService {
  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    @InjectRepository(BusinessMemberPermission)
    private readonly permissionRepository: Repository<BusinessMemberPermission>,
    private readonly membershipCache: BusinessMembershipCacheService,
  ) {}

  async getAccessContext(
    user: BusinessAccessUser,
    businessId: number,
  ): Promise<BusinessAccessContext | null> {
    if (isSuperAdmin(user)) {
      return {
        access: 'super_admin',
        role: 'Super Admin',
        permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
        businessId,
      };
    }

    const cached = await this.membershipCache.get(businessId, user.id);
    if (cached) {
      if (cached.status !== BUSINESS_MEMBER_STATUS.ACTIVE) {
        return null;
      }
      return {
        access: cached.access,
        role: cached.role,
        permissions: cached.permissions,
        businessId,
      };
    }

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
      relations: ['owner'],
    });
    if (!business) {
      return null;
    }

    const member = await this.getAcceptedMembership(user.id, businessId);

    if (member?.role === 'Owner' || business.owner?.id === user.id) {
      const context: BusinessAccessContext = {
        access: 'owner',
        role: 'Owner',
        permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
        businessId,
      };
      await this.membershipCache.set(businessId, user.id, {
        access: 'owner',
        role: 'Owner',
        status: BUSINESS_MEMBER_STATUS.ACTIVE,
        permissions: context.permissions,
      });
      return context;
    }

    if (!member) {
      return null;
    }

    const permissions = await this.resolveMemberPermissions(member);
    const context: BusinessAccessContext = {
      access: 'member',
      role: member.role,
      permissions,
      businessId,
    };
    await this.membershipCache.set(businessId, user.id, {
      access: 'member',
      role: member.role,
      status: member.status,
      permissions,
    });
    return context;
  }

  async invalidateMembershipCache(
    businessId: number,
    userId: number,
  ): Promise<void> {
    await this.membershipCache.invalidate(businessId, userId);
  }

  async assertPermission(
    user: BusinessAccessUser,
    businessId: number,
    permission: BusinessMemberPermissionKey,
    forbiddenMessage = 'You do not have permission to perform this action.',
  ): Promise<BusinessAccessContext> {
    return this.assertAnyPermission(
      user,
      businessId,
      [permission],
      forbiddenMessage,
    );
  }

  async assertAnyPermission(
    user: BusinessAccessUser,
    businessId: number,
    permissions: BusinessMemberPermissionKey[],
    forbiddenMessage = 'You do not have permission to perform this action.',
  ): Promise<BusinessAccessContext> {
    const context = await this.getAccessContext(user, businessId);
    if (!context) {
      throw new ForbiddenException(
        'Business not found or you do not have access to this business.',
      );
    }

    if (
      context.access !== 'owner' &&
      context.access !== 'super_admin' &&
      !permissions.some((permission) =>
        context.permissions.includes(permission),
      )
    ) {
      throw new ForbiddenException(forbiddenMessage);
    }

    return context;
  }

  async assertOwner(
    user: BusinessAccessUser,
    businessId: number,
    forbiddenMessage = 'Only the business owner can perform this action.',
  ): Promise<void> {
    if (isSuperAdmin(user)) {
      return;
    }

    const context = await this.getAccessContext(user, businessId);
    if (context?.access === 'owner' || context?.role === 'Owner') {
      return;
    }

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
      relations: ['owner'],
    });

    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    if (business.owner?.id !== user.id) {
      throw new ForbiddenException(forbiddenMessage);
    }
  }

  async findAccessibleBusiness(
    user: BusinessAccessUser,
    businessId: number,
  ): Promise<Business | null> {
    if (isSuperAdmin(user)) {
      return this.businessRepository.findOne({
        where: { id: businessId },
        relations: ['owner'],
      });
    }

    const context = await this.getAccessContext(user, businessId);
    if (!context) {
      return null;
    }

    return this.businessRepository.findOne({
      where: { id: businessId },
      relations: ['owner'],
    });
  }

  applyAccessibleBusinessFilter(
    qb: SelectQueryBuilder<Business>,
    user: BusinessAccessUser,
  ): void {
    if (isSuperAdmin(user)) {
      return;
    }

    qb.andWhere(
      new Brackets((sub) => {
        sub
          .where('business.owner_id = :accessUserId', {
            accessUserId: user.id,
          })
          .orWhere(
            `EXISTS (
              SELECT 1
              FROM business_members bm
              WHERE bm.business_id = business.id
                AND bm.user_id = :accessUserId
                AND bm.status = :activeMemberStatus
            )`,
            {
              accessUserId: user.id,
              activeMemberStatus: BUSINESS_MEMBER_STATUS.ACTIVE,
            },
          );
      }),
    );
  }

  async listAccessibleBusinessIds(userId: number): Promise<number[]> {
    const owned = await this.businessRepository.find({
      where: { owner: { id: userId } },
      select: { id: true },
    });

    const memberships = await this.businessMemberRepository.find({
      where: {
        user: { id: userId },
        status: BUSINESS_MEMBER_STATUS.ACTIVE,
      },
      relations: ['business'],
    });

    return [
      ...new Set([
        ...owned.map((business) => business.id),
        ...memberships.map((membership) => membership.business.id),
      ]),
    ];
  }

  private async getAcceptedMembership(
    userId: number,
    businessId: number,
  ): Promise<BusinessMember | null> {
    const member = await this.businessMemberRepository.findOne({
      where: {
        business: { id: businessId },
        user: { id: userId },
        status: BUSINESS_MEMBER_STATUS.ACTIVE,
      },
      relations: ['user', 'business', 'permissionRows'],
    });

    return member ?? null;
  }

  private async resolveMemberPermissions(
    member: BusinessMember,
  ): Promise<BusinessMemberPermissionKey[]> {
    if (member.role === 'Owner') {
      return [...ALL_BUSINESS_MEMBER_PERMISSIONS];
    }

    if (member.permissionRows?.length) {
      return member.permissionRows.map(
        (row) => row.permission as BusinessMemberPermissionKey,
      );
    }

    const rows = await this.permissionRepository.find({
      where: { businessMember: { id: member.id } },
    });

    if (rows.length > 0) {
      return rows.map((row) => row.permission as BusinessMemberPermissionKey);
    }

    return (member.permissions ?? []) as BusinessMemberPermissionKey[];
  }
}
