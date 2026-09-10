import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  buildPaginationMeta,
  normalizePagination,
  type PaginationMeta,
} from '../../common/pagination';
import { Business } from '../../db/entities/business.entity';
import {
  BusinessInvitation,
  BusinessInvitationStatus,
} from '../../db/entities/business-invitation.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { isAdminOrSuperAdmin, isSuperAdmin } from '../../utils/user-roles';
import { BusinessAccessService } from '../business-access/business-access.service';
import { normalizeInvitationRole } from '../invitation/invitationDto/create-business-invitation.dto';
import { FULL_ACCESS_PERMISSION } from './member.constants';
import { normalizeMemberPermissions } from './member-permissions.util';
import type { UpdateBusinessMemberDto } from './memberDto/update-business-member.dto';

type AuthUser = {
  id: number;
  email: string;
  role?: { name: string } | null;
};

export type MemberListItem = {
  id: number | null;
  userId: number;
  name: string;
  email: string;
  role: string;
  status: 'owner' | 'active' | 'pending';
  permissions: string[];
  invitedAt?: string;
  expiresAt?: string;
};

export type MembersListStats = {
  activeCount: number;
  pendingCount: number;
  fullAccessCount: number;
  roleCount: number;
};

export type MembersListResponse = {
  members: MemberListItem[];
  meta: PaginationMeta;
  stats: MembersListStats;
};

@Injectable()
export class MemberService {
  private readonly logger = new Logger(MemberService.name);

  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    @InjectRepository(BusinessInvitation)
    private readonly businessInvitationRepository: Repository<BusinessInvitation>,
    private readonly dataSource: DataSource,
    private readonly businessAccessService: BusinessAccessService,
  ) {}

  async getMyAccess(
    businessId: number,
    user: AuthUser,
  ): Promise<{
    businessId: number;
    access: 'owner' | 'member' | 'super_admin';
    role: string;
    permissions: string[];
  }> {
    const context = await this.businessAccessService.getAccessContext(
      user,
      businessId,
    );
    if (!context) {
      throw new ForbiddenException(
        'Business not found or you do not have access to this business.',
      );
    }

    return {
      businessId: context.businessId,
      access: context.access,
      role: context.role,
      permissions: context.permissions,
    };
  }

  async getMembers(
    businessId: number,
    user: AuthUser,
    options?: { page?: number; limit?: number; search?: string },
  ): Promise<MembersListResponse> {
    const business = await this.getBusinessOrThrow(businessId);
    await this.assertCanViewMembers(business, user);

    const activeMembers = await this.businessMemberRepository.find({
      where: { business: { id: businessId } },
      relations: ['user', 'user.role', 'permissionRows'],
      order: { createdAt: 'ASC' },
    });

    const pendingInvites = await this.businessInvitationRepository.find({
      where: {
        business: { id: businessId },
        status: BusinessInvitationStatus.PENDING,
      },
      order: { createdAt: 'DESC' },
    });

    const now = Date.now();
    const activePending = pendingInvites.filter(
      (invite) => invite.expiresAt.getTime() > now,
    );

    const memberEmails = new Set(
      activeMembers.map((member) => this.normalizeEmail(member.user.email)),
    );

    // --- Build unified roster (owner + active + pending), then paginate in API ---
    const allMembers: MemberListItem[] = [
      {
        id: null,
        userId: business.owner.id,
        name: business.owner.name?.trim() || business.owner.email,
        email: business.owner.email,
        role: 'Owner',
        status: 'owner',
        permissions: [FULL_ACCESS_PERMISSION],
      },
      ...activeMembers.map((member) => {
        const permissionList =
          member.permissionRows?.length > 0
            ? member.permissionRows.map((row) => row.permission)
            : (member.permissions ?? []);

        return {
          id: member.id,
          userId: member.user.id,
          name: member.user.name?.trim() || member.user.email,
          email: member.user.email,
          role: member.role,
          status: 'active' as const,
          permissions: isAdminOrSuperAdmin(member.user)
            ? [FULL_ACCESS_PERMISSION]
            : permissionList,
        };
      }),
      ...activePending
        .filter(
          (invite) => !memberEmails.has(this.normalizeEmail(invite.email)),
        )
        .map((invite) => ({
          id: invite.id,
          userId: 0,
          name: invite.email.split('@')[0] || invite.email,
          email: invite.email,
          role: invite.role,
          status: 'pending' as const,
          permissions: invite.permissions ?? [],
          invitedAt: invite.createdAt.toISOString(),
          expiresAt: invite.expiresAt.toISOString(),
        })),
    ];

    const stats: MembersListStats = {
      activeCount: allMembers.filter((m) => m.status !== 'pending').length,
      pendingCount: allMembers.filter((m) => m.status === 'pending').length,
      fullAccessCount: allMembers.filter((m) => m.status === 'owner').length,
      roleCount: new Set(
        allMembers.map((m) => m.role.trim().toLowerCase()).filter(Boolean),
      ).size,
    };

    const search = options?.search?.trim().toLowerCase() ?? '';
    const filtered = search
      ? allMembers.filter((member) => {
          const haystack =
            `${member.name} ${member.email} ${member.role}`.toLowerCase();
          return haystack.includes(search);
        })
      : allMembers;

    const pagination = normalizePagination(options?.page, options?.limit);
    const members = filtered.slice(
      pagination.skip,
      pagination.skip + pagination.limit,
    );

    return {
      members,
      meta: buildPaginationMeta(filtered.length, pagination.page, pagination.limit),
      stats,
    };
  }

  async removeMember(
    memberId: number,
    user: AuthUser,
  ): Promise<{ message: string }> {
    const member = await this.businessMemberRepository.findOne({
      where: { id: memberId },
      relations: ['business', 'business.owner', 'user'],
    });

    if (member) {
      await this.assertCanManageMembers(member.business, user);
      if (member.business.owner?.id === member.user.id) {
        throw new ForbiddenException('The business owner cannot be removed.');
      }
      await this.purgeMemberAccess(
        member.business.id,
        member.user.email,
        member.user.id,
      );
      return { message: 'Member access removed successfully.' };
    }

    const businessInvitation = await this.businessInvitationRepository.findOne({
      where: { id: memberId },
      relations: ['business', 'business.owner'],
    });

    if (!businessInvitation) {
      throw new NotFoundException('Member not found.');
    }

    await this.assertCanManageMembers(businessInvitation.business, user);
    if (businessInvitation.status === BusinessInvitationStatus.PENDING) {
      businessInvitation.status = BusinessInvitationStatus.CANCELLED;
      await this.businessInvitationRepository.save(businessInvitation);
    }
    return { message: 'Member access removed successfully.' };
  }

  async updateMember(
    memberId: number,
    dto: UpdateBusinessMemberDto,
    user: AuthUser,
  ): Promise<{
    message: string;
    member: MemberListItem;
  }> {
    const member = await this.businessMemberRepository.findOne({
      where: { id: memberId },
      relations: ['business', 'business.owner', 'user', 'user.role', 'permissionRows'],
    });

    if (!member) {
      throw new NotFoundException('Member not found.');
    }

    await this.assertCanManageMembers(member.business, user);

    if (member.business.owner?.id === member.user.id) {
      throw new ForbiddenException('The business owner access cannot be edited.');
    }

    const role = normalizeInvitationRole(dto.role);
    if (!role) {
      throw new BadRequestException('Role must be Manager or Staff.');
    }

    const permissions = normalizeMemberPermissions(dto.permissions, role);

    const platformRole = await this.dataSource.getRepository(Role).findOne({
      where: { name: role },
    });
    if (!platformRole) {
      throw new InternalServerErrorException(
        `Role '${role}' does not exist. Seed Manager and Staff roles first.`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(BusinessMember);
      const permissionRepo = manager.getRepository(BusinessMemberPermission);
      const userRepo = manager.getRepository(User);

      member.role = role;
      member.memberRole = platformRole;
      member.permissions = permissions;
      await memberRepo.save(member);

      await permissionRepo.delete({ businessMember: { id: member.id } });
      if (permissions.length > 0) {
        await permissionRepo.save(
          permissions.map((permission) =>
            permissionRepo.create({
              businessMember: member,
              permission,
            }),
          ),
        );
      }

      await userRepo
        .createQueryBuilder()
        .update(User)
        .set({ role: { id: platformRole.id } })
        .where('id = :id', { id: member.user.id })
        .execute();
    });

    return {
      message: 'Member access updated successfully.',
      member: {
        id: member.id,
        userId: member.user.id,
        name: member.user.name?.trim() || member.user.email,
        email: member.user.email,
        role,
        status: 'active',
        permissions,
      },
    };
  }

  private async purgeMemberAccess(
    businessId: number,
    email: string,
    userId: number | null,
  ): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);

    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(BusinessMember);
      const userRepo = manager.getRepository(User);
      const businessRepo = manager.getRepository(Business);

      await memberRepo
        .createQueryBuilder()
        .delete()
        .from(BusinessMember)
        .where('business_id = :businessId', { businessId })
        .andWhere(
          'user_id IN (SELECT id FROM "users" WHERE LOWER(email) = :email)',
          { email: normalizedEmail },
        )
        .execute();

      await manager
        .getRepository(BusinessInvitation)
        .createQueryBuilder()
        .update(BusinessInvitation)
        .set({ status: BusinessInvitationStatus.CANCELLED })
        .where('business_id = :businessId', { businessId })
        .andWhere('LOWER(email) = :email', { email: normalizedEmail })
        .andWhere('status = :status', {
          status: BusinessInvitationStatus.PENDING,
        })
        .execute();

      if (userId == null) {
        return;
      }

      const targetUser = await userRepo.findOne({
        where: { id: userId },
      });

      if (!targetUser) {
        return;
      }

      const ownedBusinesses = await businessRepo.count({
        where: { owner: { id: targetUser.id } },
      });
      const remainingMemberships = await memberRepo.count({
        where: { user: { id: targetUser.id } },
      });

      if (ownedBusinesses === 0 && remainingMemberships === 0) {
        await userRepo.delete({ id: targetUser.id });
        this.logger.log(
          `Invited user ${targetUser.id} (${normalizedEmail}) deleted after access removal from business ${businessId}`,
        );
      }
    });
  }

  private async getBusinessOrThrow(businessId: number): Promise<Business> {
    const business = await this.businessRepository.findOne({
      where: { id: businessId },
      relations: ['owner', 'owner.role'],
    });

    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    return business;
  }

  private async assertCanManageMembers(
    business: Business,
    user: AuthUser,
  ): Promise<void> {
    await this.businessAccessService.assertAnyPermission(
      user,
      business.id,
      ['members'],
      'You do not have permission to manage members for this business.',
    );
  }

  private async assertCanViewMembers(
    business: Business,
    user: AuthUser,
  ): Promise<void> {
    if (isSuperAdmin(user)) {
      return;
    }

    if (business.owner?.id === user.id) {
      return;
    }

    const membership = await this.businessMemberRepository.findOne({
      where: {
        business: { id: business.id },
        user: { id: user.id },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this business.');
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
