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
import { isSuperAdmin } from '../../utils/user-roles';

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

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
      relations: ['owner'],
    });
    if (!business) {
      return null;
    }

    if (business.owner?.id === user.id) {
      return {
        access: 'owner',
        role: 'Owner',
        permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
        businessId,
      };
    }

    const member = await this.getAcceptedMembership(user.id, businessId);
    if (!member) {
      return null;
    }

    const permissions = await this.resolveMemberPermissions(member);
    return {
      access: 'member',
      role: member.role,
      permissions,
      businessId,
    };
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

    const owned = await this.businessRepository.findOne({
      where: { id: businessId, owner: { id: user.id } },
      relations: ['owner'],
    });
    if (owned) {
      return owned;
    }

    const member = await this.getAcceptedMembership(user.id, businessId);
    if (!member) {
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
            )`,
            { accessUserId: user.id },
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
      where: { user: { id: userId } },
      relations: ['business', 'user'],
    });

    const acceptedMemberBusinessIds: number[] = [];
    for (const membership of memberships) {
      const accepted = await this.isMembershipAccepted(membership);
      if (accepted) {
        acceptedMemberBusinessIds.push(membership.business.id);
      }
    }

    return [
      ...new Set([
        ...owned.map((business) => business.id),
        ...acceptedMemberBusinessIds,
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
      },
      relations: ['user', 'business', 'permissionRows'],
    });

    if (!member) {
      return null;
    }

    const accepted = await this.isMembershipAccepted(member);
    return accepted ? member : null;
  }

  private async isMembershipAccepted(member: BusinessMember): Promise<boolean> {
    return Boolean(member);
  }

  private async resolveMemberPermissions(
    member: BusinessMember,
  ): Promise<BusinessMemberPermissionKey[]> {
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
