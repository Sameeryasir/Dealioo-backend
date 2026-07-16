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
import { createHash, randomBytes } from 'crypto';
import { render } from '@react-email/render';
import * as React from 'react';
import { DataSource, Repository } from 'typeorm';
import {
  BusinessInvitation,
  BusinessInvitationStatus,
} from '../../db/entities/business-invitation.entity';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import { BrevoSendFailedError } from '../mail/brevo-mail.errors';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { MemberInviteEmail } from '../../templates/member-invite-email';
import { BusinessAccessService } from '../business-access/business-access.service';
import { normalizeMemberPermissions } from '../member/member-permissions.util';
import { BUSINESS_INVITATION_EXPIRY_DAYS } from './invitation.constants';
import {
  CreateBusinessInvitationDto,
  normalizeInvitationRole,
} from './invitationDto/create-business-invitation.dto';

type AuthUser = {
  id: number;
  email: string;
  role?: { name: string } | null;
};

export type ValidateInvitationResult = {
  valid: boolean;
  accountExists: boolean;
  businessName: string;
  email: string;
  role: string;
};

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @InjectRepository(BusinessInvitation)
    private readonly invitationRepository: Repository<BusinessInvitation>,
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly businessAccessService: BusinessAccessService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly dataSource: DataSource,
  ) {}

  async createInvitation(
    businessId: number,
    dto: CreateBusinessInvitationDto,
    user: AuthUser,
  ): Promise<{ message: string; invitationId: number }> {
    await this.businessAccessService.assertAnyPermission(
      user,
      businessId,
      ['members'],
      'You do not have permission to invite members.',
    );

    const business = await this.businessRepository.findOne({
      where: { id: businessId },
      relations: ['owner'],
    });
    if (!business) {
      throw new NotFoundException('Business not found.');
    }

    const role = normalizeInvitationRole(dto.role);
    if (!role) {
      throw new BadRequestException('Role must be Manager or Staff.');
    }

    const email = this.normalizeEmail(dto.email);
    const permissions = normalizeMemberPermissions(dto.permissions, role);

    if (this.normalizeEmail(business.owner.email) === email) {
      throw new ConflictException('The business owner is already a member.');
    }

    const existingMember = await this.businessMemberRepository
      .createQueryBuilder('member')
      .innerJoin('member.user', 'user')
      .where('member.business_id = :businessId', { businessId })
      .andWhere('LOWER(user.email) = :email', { email })
      .getOne();

    if (existingMember) {
      throw new ConflictException(
        'This user is already a member of the business.',
      );
    }

    const pendingInvite = await this.invitationRepository.findOne({
      where: {
        business: { id: businessId },
        email,
        status: BusinessInvitationStatus.PENDING,
      },
    });

    if (pendingInvite && pendingInvite.expiresAt.getTime() > Date.now()) {
      throw new ConflictException(
        'An active invitation has already been sent to this email.',
      );
    }

    if (pendingInvite) {
      pendingInvite.status = BusinessInvitationStatus.EXPIRED;
      await this.invitationRepository.save(pendingInvite);
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + BUSINESS_INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const invitation = await this.invitationRepository.save(
      this.invitationRepository.create({
        business,
        email,
        role,
        permissions,
        tokenHash,
        status: BusinessInvitationStatus.PENDING,
        invitedBy: { id: user.id } as User,
        expiresAt,
        acceptedAt: null,
      }),
    );

    const acceptUrl = `${getFrontendBaseUrl()}/accept-invitation?token=${rawToken}`;

    await this.sendInviteEmail({
      to: email,
      businessName: business.name,
      inviterName: business.owner.name?.trim() || user.email,
      role,
      permissions,
      acceptUrl,
    });

    return {
      message: 'Invitation sent successfully.',
      invitationId: invitation.id,
    };
  }

  async validateInvitation(rawToken: string): Promise<ValidateInvitationResult> {
    const invitation = await this.findPendingInvitationByRawToken(rawToken);

    const existingUser = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = :email', {
        email: this.normalizeEmail(invitation.email),
      })
      .getOne();

    return {
      valid: true,
      accountExists: Boolean(existingUser?.passwordHash),
      businessName: invitation.business.name,
      email: invitation.email,
      role: invitation.role,
    };
  }

  async acceptInvitationForUser(
    rawToken: string,
    user: AuthUser,
  ): Promise<{ message: string; businessId: number }> {
    const invitation = await this.findPendingInvitationByRawToken(rawToken);
    const inviteEmail = this.normalizeEmail(invitation.email);
    const userEmail = this.normalizeEmail(user.email);

    if (inviteEmail !== userEmail) {
      throw new ForbiddenException(
        'Sign in with the email address this invitation was sent to.',
      );
    }

    const tokenHash = this.hashToken(rawToken);

    const businessId = await this.dataSource.transaction(async (manager) => {
      const invitationRepo = manager.getRepository(BusinessInvitation);
      const memberRepo = manager.getRepository(BusinessMember);
      const permissionRepo = manager.getRepository(BusinessMemberPermission);
      const roleRepo = manager.getRepository(Role);
      const userRepo = manager.getRepository(User);

      const locked = await invitationRepo
        .createQueryBuilder('invite')
        .where('invite.tokenHash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write')
        .getOne();

      if (!locked || locked.status !== BusinessInvitationStatus.PENDING) {
        throw new ConflictException('This invitation is no longer pending.');
      }
      if (locked.expiresAt.getTime() <= Date.now()) {
        locked.status = BusinessInvitationStatus.EXPIRED;
        await invitationRepo.save(locked);
        throw new BadRequestException('This invitation has expired.');
      }

      const businessIdRaw = await invitationRepo
        .createQueryBuilder('invite')
        .select('invite.business_id', 'businessId')
        .where('invite.id = :id', { id: locked.id })
        .getRawOne<{ businessId: number | string }>();

      const businessId = Number(businessIdRaw?.businessId);
      if (!Number.isFinite(businessId) || businessId < 1) {
        throw new NotFoundException('Business not found for this invitation.');
      }

      const business = await manager.getRepository(Business).findOne({
        where: { id: businessId },
      });
      if (!business) {
        throw new NotFoundException('Business not found for this invitation.');
      }

      const fullUser = await userRepo.findOne({
        where: { id: user.id },
        relations: ['role'],
      });
      if (!fullUser) {
        throw new NotFoundException('User not found.');
      }

      const platformRole = await roleRepo.findOne({
        where: { name: locked.role },
      });
      if (!platformRole) {
        throw new InternalServerErrorException(
          `Role '${locked.role}' does not exist.`,
        );
      }

      await userRepo
        .createQueryBuilder()
        .update(User)
        .set({ role: { id: platformRole.id } })
        .where('id = :id', { id: fullUser.id })
        .execute();
      fullUser.role = platformRole;

      let member = await memberRepo.findOne({
        where: {
          business: { id: business.id },
          user: { id: fullUser.id },
        },
      });

      if (!member) {
        member = await memberRepo.save(
          memberRepo.create({
            business,
            user: fullUser,
            role: locked.role,
            memberRole: platformRole,
            permissions: locked.permissions ?? [],
          }),
        );
      } else {
        member.role = locked.role;
        member.memberRole = platformRole;
        member.permissions = locked.permissions ?? [];
        member = await memberRepo.save(member);
      }

      await permissionRepo.delete({ businessMember: { id: member.id } });
      const keys = locked.permissions ?? [];
      if (keys.length > 0) {
        await permissionRepo.save(
          keys.map((permission) =>
            permissionRepo.create({
              businessMember: member!,
              permission,
            }),
          ),
        );
      }

      locked.status = BusinessInvitationStatus.ACCEPTED;
      locked.acceptedAt = new Date();
      await invitationRepo.save(locked);

      return business.id;
    });

    return {
      message: 'Invitation accepted successfully.',
      businessId,
    };
  }

  async findPendingInvitationByRawToken(
    rawToken: string,
  ): Promise<BusinessInvitation> {
    const token = rawToken?.trim();
    if (!token || token.length < 32) {
      throw new BadRequestException('Invalid invitation token.');
    }

    const invitation = await this.invitationRepository.findOne({
      where: { tokenHash: this.hashToken(token) },
      relations: ['business', 'business.owner', 'invitedBy'],
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found.');
    }

    if (invitation.status === BusinessInvitationStatus.CANCELLED) {
      throw new BadRequestException('This invitation was cancelled.');
    }

    if (invitation.status === BusinessInvitationStatus.ACCEPTED) {
      throw new ConflictException('This invitation has already been accepted.');
    }

    if (
      invitation.status === BusinessInvitationStatus.EXPIRED ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      if (invitation.status === BusinessInvitationStatus.PENDING) {
        invitation.status = BusinessInvitationStatus.EXPIRED;
        await this.invitationRepository.save(invitation);
      }
      throw new BadRequestException('This invitation has expired.');
    }

    if (invitation.status !== BusinessInvitationStatus.PENDING) {
      throw new BadRequestException('This invitation is no longer valid.');
    }

    return invitation;
  }

  hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken.trim()).digest('hex');
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async sendInviteEmail(params: {
    to: string;
    businessName: string;
    inviterName: string;
    role: string;
    permissions: string[];
    acceptUrl: string;
  }): Promise<void> {
    const expiresInDays = BUSINESS_INVITATION_EXPIRY_DAYS;
    const html = await render(
      React.createElement(MemberInviteEmail, {
        businessName: params.businessName,
        inviterName: params.inviterName,
        role: params.role,
        acceptUrl: params.acceptUrl,
        expiresInDays,
        permissions: params.permissions,
      }),
    );

    const text = [
      `${params.inviterName} invited you to join ${params.businessName} as ${params.role}.`,
      `Accept: ${params.acceptUrl}`,
      `This link expires in ${expiresInDays} days.`,
    ].join('\n');

    try {
      await this.mailDelivery.sendHtmlEmail({
        to: params.to,
        subject:
          process.env.MAIL_MEMBER_INVITE_SUBJECT?.trim() ||
          `You're invited to join ${params.businessName}`,
        html,
        text,
        tags: ['member', 'invite'],
      });
    } catch (error) {
      this.logger.error(
        `Failed to send invitation email to ${params.to}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (error instanceof BrevoSendFailedError) {
        throw new BadRequestException(
          'Invitation was created but the email could not be sent. Try again later.',
        );
      }
      throw error;
    }
  }
}
