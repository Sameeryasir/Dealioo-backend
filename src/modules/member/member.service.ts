import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import * as React from 'react';
import { render } from '@react-email/render';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { MemberInvite } from '../../db/entities/member-invite.entity';
import { User } from '../../db/entities/user.entity';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { BrevoSendFailedError } from '../mail/brevo-mail.errors';
import { MemberInviteEmail } from '../../templates/member-invite-email';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { isSuperAdmin } from '../../utils/user-roles';
import {
  ALL_BUSINESS_MEMBER_PERMISSIONS,
  BUSINESS_MEMBER_ROLES,
  MEMBER_INVITE_EXPIRY_DAYS,
  type BusinessMemberRole,
} from './member.constants';
import { normalizeMemberPermissions } from './member-permissions.util';
import { AcceptMemberInviteDto } from './memberDto/accept-member-invite.dto';
import { InviteMemberDto } from './memberDto/invite-member.dto';

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
    @InjectRepository(MemberInvite)
    private readonly memberInviteRepository: Repository<MemberInvite>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly mailDelivery: MailDeliveryService,
    private readonly dataSource: DataSource,
  ) {}

  async inviteMember(
    dto: InviteMemberDto,
    user: AuthUser,
  ): Promise<{ message: string; inviteId: number }> {
    const business = await this.getBusinessOrThrow(dto.businessId);
    this.assertBusinessOwner(business, user);

    const normalizedEmail = this.normalizeEmail(dto.email);
    this.assertValidRole(dto.role);
    const permissions = normalizeMemberPermissions(dto.permissions, dto.role);

    if (this.normalizeEmail(business.owner.email) === normalizedEmail) {
      throw new ConflictException('The business owner is already a member.');
    }

    const existingUser = await this.findUserByEmail(normalizedEmail);

    if (existingUser) {
      const existingMember = await this.businessMemberRepository.findOne({
        where: {
          business: { id: business.id },
          user: { id: existingUser.id },
        },
      });

      if (existingMember) {
        throw new ConflictException('This user is already a member of the business.');
      }
    }

    const now = new Date();
    const pendingInvite = await this.memberInviteRepository.findOne({
      where: {
        business: { id: business.id },
        email: normalizedEmail,
        acceptedAt: IsNull(),
        expiresAt: MoreThan(now),
      },
    });

    if (pendingInvite) {
      throw new ConflictException(
        'An active invitation has already been sent to this email.',
      );
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      now.getTime() + MEMBER_INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const invite = this.memberInviteRepository.create({
      business,
      email: normalizedEmail,
      role: dto.role,
      permissions,
      token,
      invitedBy: { id: user.id } as User,
      expiresAt,
      acceptedAt: null,
    });

    const savedInvite = await this.memberInviteRepository.save(invite);

    await this.sendInviteEmail({
      to: normalizedEmail,
      businessName: business.name,
      inviterName: business.owner.name?.trim() || user.email,
      role: dto.role,
      permissions,
      token,
    });

    return {
      message: 'Invitation sent successfully.',
      inviteId: savedInvite.id,
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
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });

    const pendingInvites = await this.memberInviteRepository.find({
      where: {
        business: { id: businessId },
        acceptedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

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
      ...activeMembers.map((member) => ({
        id: member.id,
        userId: member.user.id,
        name: member.user.name?.trim() || member.user.email,
        email: member.user.email,
        role: member.role,
        status: 'active' as const,
        permissions: member.permissions ?? [],
      })),
      ...pendingInvites.map((invite) => ({
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

  async acceptInvite(
    dto: AcceptMemberInviteDto,
    user: AuthUser,
  ): Promise<{ message: string; businessId: number }> {
    const invite = await this.memberInviteRepository.findOne({
      where: { token: dto.token.trim() },
      relations: ['business', 'business.owner'],
    });

    if (!invite) {
      throw new NotFoundException('Invitation not found.');
    }

    if (invite.acceptedAt) {
      throw new ConflictException('This invitation has already been accepted.');
    }

    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This invitation has expired.');
    }

    const normalizedInviteEmail = this.normalizeEmail(invite.email);
    const normalizedUserEmail = this.normalizeEmail(user.email);

    if (normalizedInviteEmail !== normalizedUserEmail) {
      throw new ForbiddenException(
        'Sign in with the email address that received this invitation.',
      );
    }

    const fullUser = await this.userRepository.findOne({
      where: { id: user.id },
    });

    if (!fullUser) {
      throw new NotFoundException('User not found.');
    }

    if (
      this.normalizeEmail(invite.business.owner.email) === normalizedUserEmail
    ) {
      throw new ConflictException('You are already the owner of this business.');
    }

    const existingMember = await this.businessMemberRepository.findOne({
      where: {
        business: { id: invite.business.id },
        user: { id: fullUser.id },
      },
    });

    if (existingMember) {
      throw new ConflictException('You are already a member of this business.');
    }

    await this.dataSource.transaction(async (manager) => {
      const memberRepo = manager.getRepository(BusinessMember);
      const inviteRepo = manager.getRepository(MemberInvite);

      await memberRepo.save(
        memberRepo.create({
          business: invite.business,
          user: fullUser,
          role: invite.role,
          permissions: invite.permissions ?? [],
        }),
      );

      invite.acceptedAt = new Date();
      await inviteRepo.save(invite);
    });

    return {
      message: 'Invitation accepted successfully.',
      businessId: invite.business.id,
    };
  }

  async removeMember(memberId: number, user: AuthUser): Promise<{ message: string }> {
    const member = await this.businessMemberRepository.findOne({
      where: { id: memberId },
      relations: ['business', 'business.owner', 'user'],
    });

    if (!member) {
      throw new NotFoundException('Member not found.');
    }

    this.assertBusinessOwner(member.business, user);

    await this.businessMemberRepository.remove(member);

    return { message: 'Member removed successfully.' };
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

  private assertValidRole(role: string): asserts role is BusinessMemberRole {
    if (!BUSINESS_MEMBER_ROLES.includes(role as BusinessMemberRole)) {
      throw new BadRequestException('Invalid member role.');
    }
  }

  private async findUserByEmail(email: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = :email', { email: this.normalizeEmail(email) })
      .getOne();
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async sendInviteEmail(params: {
    to: string;
    businessName: string;
    inviterName: string;
    role: string;
    permissions: string[];
    token: string;
  }): Promise<void> {
    const acceptUrl = `${getFrontendBaseUrl()}/accept-invite?token=${encodeURIComponent(params.token)}`;
    const subject =
      process.env.MAIL_MEMBER_INVITE_SUBJECT?.trim() ||
      `You're invited to join ${params.businessName}`;

    const html = await render(
      React.createElement(MemberInviteEmail, {
        businessName: params.businessName,
        inviterName: params.inviterName,
        role: params.role,
        acceptUrl,
        expiresInDays: MEMBER_INVITE_EXPIRY_DAYS,
        permissions: params.permissions,
      }),
    );

    const text = [
      `${params.inviterName} invited you to join ${params.businessName} as ${params.role}.`,
      ...(params.permissions.length
        ? [`Access: ${params.permissions.join(', ')}`]
        : []),
      '',
      `Accept your invitation: ${acceptUrl}`,
      '',
      `This link expires in ${MEMBER_INVITE_EXPIRY_DAYS} days.`,
    ].join('\n');

    try {
      await this.mailDelivery.sendHtmlEmail({
        to: params.to,
        subject,
        html,
        text,
        tags: ['member', 'invite'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to send member invite email to ${params.to}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (error instanceof BrevoSendFailedError) {
        throw new InternalServerErrorException(
          'Invitation could not be sent. Please try again later.',
        );
      }

      throw error;
    }
  }
}
