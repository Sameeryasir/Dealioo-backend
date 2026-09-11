import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { render } from '@react-email/render';
import * as React from 'react';
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
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { MemberAccessRemovedEmail } from '../../templates/member-access-removed-email';
import { isAdminOrSuperAdmin, isSuperAdmin } from '../../utils/user-roles';
import { BusinessAccessService } from '../business-access/business-access.service';
import { normalizeInvitationRole } from '../invitation/invitationDto/create-business-invitation.dto';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { PusherService } from '../pusher/pusher.service';
import { BUSINESS_MEMBER_STATUS } from './business-member-status';
import {
  FULL_ACCESS_PERMISSION,
  INVITABLE_ROLE_ERROR,
} from './member.constants';
import {
  normalizeMemberPermissions,
  syncMemberPermissionRows,
} from './member-permissions.util';
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

type AccessRemovalNotifyParams = {
  toEmail: string;
  businessId: number;
  businessName: string;
  removedByName: string;
  kind: 'member' | 'invite';
  userId: number | null;
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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly businessAccessService: BusinessAccessService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly pusherService: PusherService,
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

    const search = options?.search?.trim().toLowerCase() ?? '';
    const now = new Date();

    const activeMembersQb = this.businessMemberRepository
      .createQueryBuilder('member')
      .leftJoinAndSelect('member.user', 'user')
      .leftJoinAndSelect('user.role', 'userRole')
      .leftJoinAndSelect('member.permissionRows', 'permissionRows')
      .where('member.business_id = :businessId', { businessId })
      .andWhere('member.status = :status', {
        status: BUSINESS_MEMBER_STATUS.ACTIVE,
      })
      .orderBy('member.created_at', 'ASC');

    if (search) {
      activeMembersQb.andWhere(
        `(LOWER(COALESCE(user.name, '')) LIKE :search
          OR LOWER(user.email) LIKE :search
          OR LOWER(member.role) LIKE :search)`,
        { search: `%${search}%` },
      );
    }

    const pendingInvitesQb = this.businessInvitationRepository
      .createQueryBuilder('invite')
      .where('invite.business_id = :businessId', { businessId })
      .andWhere('invite.status = :status', {
        status: BusinessInvitationStatus.PENDING,
      })
      .andWhere('invite.expires_at > :now', { now })
      .orderBy('invite.created_at', 'DESC');

    if (search) {
      pendingInvitesQb.andWhere(
        `(LOWER(invite.email) LIKE :search OR LOWER(invite.role) LIKE :search)`,
        { search: `%${search}%` },
      );
    }

    const [activeMembers, pendingInvites] = await Promise.all([
      activeMembersQb.getMany(),
      pendingInvitesQb.getMany(),
    ]);

    const memberEmails = new Set(
      activeMembers.map((member) => this.normalizeEmail(member.user.email)),
    );

    const hasOwnerMembership = activeMembers.some(
      (member) =>
        member.user.id === business.owner.id && member.role === 'Owner',
    );

    const ownerMatchesSearch =
      !search ||
      `${business.owner.name ?? ''} ${business.owner.email} owner`
        .toLowerCase()
        .includes(search);

    const allMembers: MemberListItem[] = [
      ...(hasOwnerMembership || !ownerMatchesSearch
        ? []
        : [
            {
              id: null,
              userId: business.owner.id,
              name: business.owner.name?.trim() || business.owner.email,
              email: business.owner.email,
              role: 'Owner',
              status: 'owner' as const,
              permissions: [FULL_ACCESS_PERMISSION],
            },
          ]),
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
          status:
            member.role === 'Owner'
              ? ('owner' as const)
              : ('active' as const),
          permissions:
            member.role === 'Owner' || isAdminOrSuperAdmin(member.user)
              ? [FULL_ACCESS_PERMISSION]
              : permissionList,
        };
      }),
      ...pendingInvites
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

    const pagination = normalizePagination(options?.page, options?.limit);
    const members = allMembers.slice(
      pagination.skip,
      pagination.skip + pagination.limit,
    );

    return {
      members,
      meta: buildPaginationMeta(allMembers.length, pagination.page, pagination.limit),
      stats,
    };
  }

  async removeMember(
    memberId: number,
    user: AuthUser,
  ): Promise<{ message: string }> {
    const removedByName = user.email?.trim() || 'A team manager';

    const member = await this.businessMemberRepository.findOne({
      where: { id: memberId },
      relations: ['business', 'business.owner', 'user'],
    });

    if (member) {
      await this.assertCanManageMembers(member.business, user);
      if (
        member.business.owner?.id === member.user.id ||
        member.role === 'Owner'
      ) {
        throw new ForbiddenException('The business owner cannot be removed.');
      }
      const businessId = member.business.id;
      const businessName = member.business.name?.trim() || 'the business';
      const userId = member.user.id;
      const toEmail = member.user.email;

      await this.purgeMemberAccess(
        businessId,
        member.user.email,
        userId,
      );
      await this.businessAccessService.invalidateMembershipCache(
        businessId,
        userId,
      );

      void this.notifyAccessRemoved({
        toEmail,
        businessId,
        businessName,
        removedByName,
        kind: 'member',
        userId,
      });

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
    const wasPending =
      businessInvitation.status === BusinessInvitationStatus.PENDING;
    if (wasPending) {
      businessInvitation.status = BusinessInvitationStatus.CANCELLED;
      await this.businessInvitationRepository.save(businessInvitation);
    }

    if (wasPending) {
      const inviteEmail = businessInvitation.email;
      const existingUser = await this.userRepository
        .createQueryBuilder('user')
        .where('LOWER(user.email) = :email', {
          email: this.normalizeEmail(inviteEmail),
        })
        .getOne();

      void this.notifyAccessRemoved({
        toEmail: inviteEmail,
        businessId: businessInvitation.business.id,
        businessName:
          businessInvitation.business.name?.trim() || 'the business',
        removedByName,
        kind: 'invite',
        userId: existingUser?.id ?? null,
      });
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

    if (member.business.owner?.id === member.user.id || member.role === 'Owner') {
      throw new ForbiddenException('The business owner access cannot be edited.');
    }

    const role = normalizeInvitationRole(dto.role);
    if (!role) {
      throw new BadRequestException(INVITABLE_ROLE_ERROR);
    }

    const permissions = normalizeMemberPermissions(dto.permissions, role);

    const memberRole = await this.dataSource.getRepository(Role).findOne({
      where: { name: role },
    });
    if (!memberRole) {
      throw new InternalServerErrorException(
        `Role '${role}' does not exist. Seed Manager, Staff, and Scanner roles first.`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(BusinessMember);

      member.role = role;
      member.memberRole = memberRole;
      member.permissions = permissions;
      member.status = BUSINESS_MEMBER_STATUS.ACTIVE;
      await memberRepo.save(member);

      await syncMemberPermissionRows(manager, member.id, permissions);
    });

    await this.businessAccessService.invalidateMembershipCache(
      member.business.id,
      member.user.id,
    );

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

  private async notifyAccessRemoved(
    params: AccessRemovalNotifyParams,
  ): Promise<void> {
    await Promise.allSettled([
      this.sendAccessRemovedEmail(params),
      params.userId != null
        ? this.pusherService.notifyMemberAccessRemoved({
            businessId: params.businessId,
            businessName: params.businessName,
            userId: params.userId,
            kind: params.kind,
            removedAt: new Date().toISOString(),
          })
        : Promise.resolve(),
    ]);
  }

  private async sendAccessRemovedEmail(
    params: AccessRemovalNotifyParams,
  ): Promise<void> {
    const html = await render(
      React.createElement(MemberAccessRemovedEmail, {
        businessName: params.businessName,
        removedByName: params.removedByName,
        kind: params.kind,
      }),
    );

    const text =
      params.kind === 'invite'
        ? [
            `${params.removedByName} cancelled your invitation to join ${params.businessName} on Dealioo.`,
            'You will no longer be able to join this business with that invite.',
          ].join('\n')
        : [
            `${params.removedByName} removed your access to ${params.businessName} on Dealioo.`,
            'You will no longer see this business in your dashboard.',
          ].join('\n');

    try {
      await this.mailDelivery.sendHtmlEmail({
        to: params.toEmail,
        subject:
          process.env.MAIL_MEMBER_ACCESS_REMOVED_SUBJECT?.trim() ||
          (params.kind === 'invite'
            ? `Your invitation to ${params.businessName} was cancelled`
            : `Your access to ${params.businessName} was removed`),
        html,
        text,
        tags: ['member', 'access-removed'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to send access-removed email to ${params.toEmail}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
