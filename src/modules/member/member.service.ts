import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Business } from '../../db/entities/business.entity';
import {
  BusinessInvitation,
  BusinessInvitationStatus,
} from '../../db/entities/business-invitation.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { User } from '../../db/entities/user.entity';
import { isSuperAdmin } from '../../utils/user-roles';
import { BusinessAccessService } from '../business-access/business-access.service';
import { ALL_BUSINESS_MEMBER_PERMISSIONS } from './member.constants';

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

export type MembersListResponse = {
  members: MemberListItem[];
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
  ): Promise<MembersListResponse> {
    const business = await this.getBusinessOrThrow(businessId);
    await this.assertCanViewMembers(business, user);

    const activeMembers = await this.businessMemberRepository.find({
      where: { business: { id: businessId } },
      relations: ['user', 'permissionRows'],
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

    const members: MemberListItem[] = [
      {
        id: null,
        userId: business.owner.id,
        name: business.owner.name?.trim() || business.owner.email,
        email: business.owner.email,
        role: 'Owner',
        status: 'owner',
        permissions: [...ALL_BUSINESS_MEMBER_PERMISSIONS],
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
          permissions: permissionList,
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

    return { members };
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
      this.assertBusinessOwner(member.business, user);
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

    this.assertBusinessOwner(businessInvitation.business, user);
    if (businessInvitation.status === BusinessInvitationStatus.PENDING) {
      businessInvitation.status = BusinessInvitationStatus.CANCELLED;
      await this.businessInvitationRepository.save(businessInvitation);
    }
    return { message: 'Member access removed successfully.' };
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
      relations: ['owner'],
    });

    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    return business;
  }

  private assertBusinessOwner(business: Business, user: AuthUser): void {
    if (isSuperAdmin(user)) {
      return;
    }

    if (business.owner?.id !== user.id) {
      throw new ForbiddenException(
        'Only the business owner can perform this action.',
      );
    }
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
