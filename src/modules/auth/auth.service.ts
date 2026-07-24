import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { BrevoSendFailedError } from '../mail/brevo-mail.errors';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { JwtService } from '@nestjs/jwt';
import { render } from '@react-email/render';
import * as React from 'react';
import { OtpEmail } from '../../templates/otp-email';
import { Business } from '../../db/entities/business.entity';
import {
  BusinessInvitation,
  BusinessInvitationStatus,
} from '../../db/entities/business-invitation.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { Otp } from '../../db/entities/otp.entity';
import { RefreshToken } from '../../db/entities/refresh-token.entity';
import { InvitationService } from '../invitation/invitation.service';
import { RegisterUserDto } from './authDto/register.dto';
import { RegisterWithInvitationDto } from './authDto/register-with-invitation.dto';
import { LoginUserDto } from './authDto/login.dto';
import { JwtAccessPayload } from './jwt/jwt-access-payload.interface';
import { VerifyOtpDto } from './authDto/verify-otp.dto';
import { ResetPasswordDto } from './authDto/reset-password.dto';
import type {
  AuthUserPlanSummary,
  GoogleAuthMode,
  GoogleAuthProfile,
  GoogleAuthResult,
} from './interfaces/google-auth.interface';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';
import {
  ADMIN_ROLE,
  MANAGER_ROLE,
  STAFF_ROLE,
} from '../../utils/user-roles';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { OnboardingEvent } from '../../db/entities/onboarding-event.entity';

const GOOGLE_SIGNUP_ROLE = ADMIN_ROLE;

type AuthUserPayload = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  firstName: string | null;
  lastName: string | null;
  provider: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  role: { id: number; name: string };
  plan: AuthUserPlanSummary;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Otp)
    private readonly otpRepository: Repository<Otp>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(UserSubscription)
    private readonly userSubscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(BusinessMember)
    private readonly businessMemberRepository: Repository<BusinessMember>,
    @InjectRepository(OnboardingEvent)
    private readonly onboardingEventRepository: Repository<OnboardingEvent>,
    private readonly invitationService: InvitationService,
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly configService: ConfigService,
  ) {}

  private async trackOnboardingEvent(input: {
    userId: number | null;
    eventName: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    const key = input.idempotencyKey.trim().slice(0, 191);
    if (!key) return;
    try {
      const exists = await this.onboardingEventRepository.exists({
        where: { idempotencyKey: key },
      });
      if (exists) return;
      await this.onboardingEventRepository.save(
        this.onboardingEventRepository.create({
          userId: input.userId,
          eventName: input.eventName.trim().slice(0, 64),
          idempotencyKey: key,
          metadata: input.metadata ?? null,
        }),
      );
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';
      if (code !== '23505') {
        this.logger.warn(
          `Onboarding event ${input.eventName} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  async registerWithInvitation(dto: RegisterWithInvitationDto): Promise<{
    message: string;
    token: string;
    refreshToken: string;
    user: AuthUserPayload;
  }> {
    const preview = await this.invitationService.findPendingInvitationByRawToken(
      dto.token,
    );
    const email = this.invitationService.normalizeEmail(preview.email);

    const existingWithPassword = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = :email', { email })
      .getOne();

    if (existingWithPassword?.passwordHash) {
      throw new ConflictException(
        'An account with this email already exists. Please sign in instead.',
      );
    }

    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Name is required.');
    }
    const phone = dto.phone?.trim() || null;

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const tokenHash = this.invitationService.hashToken(dto.token);

    const userId = await this.dataSource.transaction(async (manager) => {
      const invitationRepo = manager.getRepository(BusinessInvitation);
      const userRepo = manager.getRepository(User);
      const roleRepo = manager.getRepository(Role);
      const memberRepo = manager.getRepository(BusinessMember);
      const permissionRepo = manager.getRepository(BusinessMemberPermission);

      const invitation = await invitationRepo
        .createQueryBuilder('invite')
        .where('invite.tokenHash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write')
        .getOne();

      if (!invitation) {
        throw new NotFoundException('Invitation not found.');
      }
      if (invitation.status !== BusinessInvitationStatus.PENDING) {
        throw new ConflictException('This invitation is no longer pending.');
      }
      if (invitation.expiresAt.getTime() <= Date.now()) {
        invitation.status = BusinessInvitationStatus.EXPIRED;
        await invitationRepo.save(invitation);
        throw new BadRequestException('This invitation has expired.');
      }

      const businessIdRaw = await invitationRepo
        .createQueryBuilder('invite')
        .select('invite.business_id', 'businessId')
        .where('invite.id = :id', { id: invitation.id })
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

      const platformRole = await roleRepo.findOne({
        where: { name: invitation.role },
      });
      if (!platformRole) {
        throw new InternalServerErrorException(
          `Role '${invitation.role}' does not exist. Seed Manager and Staff roles first.`,
        );
      }

      let user = await userRepo
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('LOWER(user.email) = :email', { email })
        .setLock('pessimistic_write')
        .getOne();

      if (user?.passwordHash) {
        throw new ConflictException(
          'An account with this email already exists. Please sign in instead.',
        );
      }

      if (user) {
        user.name = name;
        user.phone = phone;
        user.passwordHash = passwordHash;
        user.emailVerified = true;
        user = await userRepo.save(user);
        await userRepo
          .createQueryBuilder()
          .update(User)
          .set({ role: { id: platformRole.id } })
          .where('id = :id', { id: user.id })
          .execute();
        user.role = platformRole;
      } else {
        user = await userRepo.save(
          userRepo.create({
            email,
            name,
            phone,
            passwordHash,
            role: platformRole,
            provider: 'LOCAL',
            emailVerified: true,
            isActive: true,
          }),
        );
        await userRepo
          .createQueryBuilder()
          .update(User)
          .set({ role: { id: platformRole.id } })
          .where('id = :id', { id: user.id })
          .execute();
        user.role = platformRole;
      }

      let member = await memberRepo.findOne({
        where: {
          business: { id: business.id },
          user: { id: user.id },
        },
      });

      if (!member) {
        member = await memberRepo.save(
          memberRepo.create({
            business,
            user,
            role: invitation.role,
            memberRole: platformRole,
            permissions: invitation.permissions ?? [],
          }),
        );
      } else {
        member.role = invitation.role;
        member.memberRole = platformRole;
        member.permissions = invitation.permissions ?? [];
        member = await memberRepo.save(member);
      }

      await permissionRepo.delete({ businessMember: { id: member.id } });
      const permissionKeys = invitation.permissions ?? [];
      if (permissionKeys.length > 0) {
        await permissionRepo.save(
          permissionKeys.map((permission) =>
            permissionRepo.create({
              businessMember: member!,
              permission,
            }),
          ),
        );
      }

      invitation.status = BusinessInvitationStatus.ACCEPTED;
      invitation.acceptedAt = new Date();
      await invitationRepo.save(invitation);

      return user.id;
    });

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    if (!user) {
      throw new InternalServerErrorException(
        'Account was created but could not be loaded.',
      );
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    const session = await this.buildAuthSession(user);
    return {
      message: 'Account created successfully.',
      ...session,
    };
  }

  async acceptBusinessInvitation(
    token: string,
    authUser: { id: number; email: string; role?: { name: string } | null },
  ): Promise<{
    message: string;
    businessId: number;
    token: string;
    refreshToken: string;
    user: AuthUserPayload;
  }> {
    const result = await this.invitationService.acceptInvitationForUser(
      token,
      authUser,
    );

    const user = await this.userRepository.findOne({
      where: { id: authUser.id },
      relations: ['role'],
    });
    if (!user) {
      throw new InternalServerErrorException('User not found after accept.');
    }

    const session = await this.buildAuthSession(user);
    return {
      message: result.message,
      businessId: result.businessId,
      ...session,
    };
  }

  async createUser(
    registerUserDto: RegisterUserDto,
  ): Promise<{ message: string }> {
    const email = registerUserDto.email.trim().toLowerCase();

    await this.trackOnboardingEvent({
      userId: null,
      eventName: 'signup_started',
      idempotencyKey: `signup_started:${email}`,
      metadata: { email },
    });

    const existingByEmail = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.role', 'role')
      .where('LOWER(user.email) = :email', { email })
      .getOne();

    if (existingByEmail?.passwordHash) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await bcrypt.hash(registerUserDto.password, 10);

    const signupRole = await this.resolveSignupRole(email, existingByEmail);

    if (existingByEmail && !existingByEmail.passwordHash) {
      existingByEmail.name = registerUserDto.name;
      existingByEmail.phone = registerUserDto.phone;
      existingByEmail.passwordHash = passwordHash;
      existingByEmail.email = email;
      existingByEmail.role = signupRole;
      const savedInvitedUser = await this.userRepository.save(existingByEmail);
      await this.sendOtpForUser(savedInvitedUser);
      await this.trackOnboardingEvent({
        userId: savedInvitedUser.id,
        eventName: 'signup_completed',
        idempotencyKey: `signup_completed:${savedInvitedUser.id}`,
      });
      return {
        message: 'User successfully registered.',
      };
    }

    const user = this.userRepository.create({
      email,
      name: registerUserDto.name,
      phone: registerUserDto.phone,
      passwordHash,
      role: signupRole,
    });

    const savedUser = await this.userRepository.save(user);

    await this.sendOtpForUser(savedUser);

    await this.trackOnboardingEvent({
      userId: savedUser.id,
      eventName: 'signup_completed',
      idempotencyKey: `signup_completed:${savedUser.id}`,
    });

    return {
      message: 'User successfully registered.',
    };
  }

  private async resolveSignupRole(
    email: string,
    existingUser: User | null,
  ): Promise<Role> {
    const hashedInvite = await this.dataSource
      .getRepository(BusinessInvitation)
      .createQueryBuilder('invite')
      .where('LOWER(invite.email) = :email', { email })
      .andWhere('invite.status = :status', {
        status: BusinessInvitationStatus.PENDING,
      })
      .andWhere('invite.expiresAt > :now', { now: new Date() })
      .orderBy('invite.id', 'DESC')
      .getOne();

    if (
      hashedInvite?.role === MANAGER_ROLE ||
      hashedInvite?.role === STAFF_ROLE
    ) {
      const inviteRole = await this.roleRepository.findOne({
        where: { name: hashedInvite.role },
      });
      if (inviteRole) {
        return inviteRole;
      }
    }

    if (existingUser?.id) {
      const membership = await this.businessMemberRepository
        .createQueryBuilder('member')
        .leftJoinAndSelect('member.memberRole', 'memberRole')
        .where('member.user_id = :userId', { userId: existingUser.id })
        .orderBy('member.id', 'DESC')
        .getOne();

      if (membership?.memberRole) {
        return membership.memberRole;
      }

      if (
        membership?.role === MANAGER_ROLE ||
        membership?.role === STAFF_ROLE
      ) {
        const memberRole = await this.roleRepository.findOne({
          where: { name: membership.role },
        });
        if (memberRole) {
          return memberRole;
        }
      }

      if (
        existingUser.role?.name === MANAGER_ROLE ||
        existingUser.role?.name === STAFF_ROLE
      ) {
        return existingUser.role;
      }
    }

    const adminRole = await this.roleRepository.findOne({
      where: { name: ADMIN_ROLE },
    });
    if (!adminRole) {
      throw new NotFoundException(`Role '${ADMIN_ROLE}' does not exist.`);
    }
    return adminRole;
  }

  async loginUser(
    loginUserDto: LoginUserDto,
  ): Promise<{
    message: string;
    token: string;
    refreshToken: string;
    user: AuthUserPayload;
  }> {
    const { email, password } = loginUserDto;

    const user = await this.userRepository.findOne({
      where: { email },
      relations: ['role'],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        firstName: true,
        lastName: true,
        provider: true,
        emailVerified: true,
        phoneVerified: true,
        passwordHash: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        role: { id: true, name: true },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('This account is inactive.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'This account uses Google sign-in. Continue with Google instead.',
      );
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return {
      message: 'Login successful.',
      ...(await this.buildAuthSession(user)),
    };
  }

 
  async handleGoogleLogin(
    profile: GoogleAuthProfile,
    mode: GoogleAuthMode = 'login',
    frontendBase?: string,
  ): Promise<{ redirectUrl: string }> {
    this.logger.log(
      `OAuth Started — Google ${mode} for ${profile.email}`,
    );

    try {
      const { user, isNewUser } = await this.resolveGoogleUser(profile, mode);
      const session = await this.buildAuthSession(user);

      this.logger.log(
        isNewUser
          ? `User Created — Google user id=${user.id} email=${user.email}`
          : `User Logged In — Google user id=${user.id} email=${user.email}`,
      );
      this.logger.log(`OAuth Success — user id=${user.id}`);

      const result: GoogleAuthResult = {
        accessToken: session.token,
        refreshToken: session.refreshToken,
        isNewUser,
        user: session.user,
      };

      return {
        redirectUrl: this.buildGoogleFrontendRedirect(result, frontendBase),
      };
    } catch (error) {
      this.logger.error(
        `OAuth Failed — Google ${mode} for ${profile.email}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  buildGoogleFrontendRedirect(
    result: GoogleAuthResult,
    frontendBase?: string,
  ): string {
    const frontend =
      frontendBase?.trim() ||
      this.configService.get<string>('FRONTEND_URL')?.split(',')[0]?.trim() ||
      getFrontendBaseUrl();
    const base = frontend.replace(/\/$/, '');
    const params = new URLSearchParams({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      isNewUser: result.isNewUser ? '1' : '0',
      user: Buffer.from(JSON.stringify(result.user), 'utf8').toString('base64url'),
    });
    return `${base}/auth/google/complete#${params.toString()}`;
  }

  buildGoogleErrorRedirect(
    message: string,
    page: '/auth/login' | '/auth/signup' = '/auth/login',
    frontendBase?: string,
  ): string {
    const frontend =
      frontendBase?.trim() ||
      this.configService.get<string>('FRONTEND_URL')?.split(',')[0]?.trim() ||
      getFrontendBaseUrl();
    const base = frontend.replace(/\/$/, '');
    const params = new URLSearchParams({
      error: message.slice(0, 300),
    });
    return `${base}${page}?${params.toString()}`;
  }

  googleErrorPageFor(
    mode: GoogleAuthMode,
    error: unknown,
  ): '/auth/login' | '/auth/signup' {
    if (error instanceof NotFoundException) {
      // No account on login → send to signup.
      return '/auth/signup';
    }
    if (error instanceof ConflictException) {
      return '/auth/login';
    }
    return mode === 'signup' ? '/auth/signup' : '/auth/login';
  }

  private async resolveGoogleUser(
    profile: GoogleAuthProfile,
    mode: GoogleAuthMode,
  ): Promise<{ user: User; isNewUser: boolean }> {
    const email = profile.email.trim().toLowerCase();

    let user = await this.userRepository.findOne({
      where: { googleId: profile.googleId },
      relations: ['role'],
    });

    if (!user) {
      user = await this.userRepository.findOne({
        where: { email },
        relations: ['role'],
      });
    }

    if (user) {
      if (!user.isActive) {
        throw new ForbiddenException('This account is inactive.');
      }

      if (mode === 'signup') {
        throw new ConflictException(
          'An account with this email already exists. Please log in with Google instead.',
        );
      }

      let dirty = false;
      if (!user.googleId) {
        user.googleId = profile.googleId;
        dirty = true;
      } else if (user.googleId !== profile.googleId) {
        throw new ConflictException(
          'This email is already linked to a different Google account.',
        );
      }

      if (user.provider === 'LOCAL' && user.googleId) {
        dirty = true;
      }

      const displayName = [profile.firstName, profile.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (displayName && user.name !== displayName) {
        user.name = displayName;
        dirty = true;
      }
      if (profile.firstName && user.firstName !== profile.firstName) {
        user.firstName = profile.firstName;
        dirty = true;
      }
      if (profile.lastName && user.lastName !== profile.lastName) {
        user.lastName = profile.lastName;
        dirty = true;
      }
      if (profile.avatar && user.avatar !== profile.avatar) {
        user.avatar = profile.avatar;
        dirty = true;
      }
      if (!user.emailVerified && profile.emailVerified) {
        user.emailVerified = true;
        dirty = true;
      }

      user.lastLoginAt = new Date();
      dirty = true;

      if (dirty) {
        user = await this.userRepository.save(user);
      }

      return { user, isNewUser: false };
    }

    if (mode === 'login') {
      throw new NotFoundException(
        'No account found with this Google email. Please sign up with Google first.',
      );
    }

    // Invited Google signups must keep Manager/Staff from the invite, not Admin.
    const role = await this.resolveSignupRole(email, null);
    if (!role) {
      throw new InternalServerErrorException(
        `Role '${GOOGLE_SIGNUP_ROLE}' does not exist. Seed roles before Google signup.`,
      );
    }

    const displayName = [profile.firstName, profile.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || email.split('@')[0];

    const created = this.userRepository.create({
      email,
      name: displayName,
      firstName: profile.firstName || null,
      lastName: profile.lastName || null,
      avatar: profile.avatar,
      googleId: profile.googleId,
      provider: 'GOOGLE',
      emailVerified: true,
      phone: null,
      passwordHash: null,
      role,
      lastLoginAt: new Date(),
    });

    const saved = await this.userRepository.save(created);
    const withRole = await this.userRepository.findOne({
      where: { id: saved.id },
      relations: ['role'],
    });
    if (!withRole) {
      throw new InternalServerErrorException('Failed to load new Google user.');
    }

    return { user: withRole, isNewUser: true };
  }

  private async buildAuthSession(user: User): Promise<{
    token: string;
    refreshToken: string;
    user: AuthUserPayload;
  }> {
    const [tokens, plan] = await Promise.all([
      this.issueAuthTokens(user),
      this.getPlanSummaryForUser(user.id),
    ]);

    return {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      user: this.toPublicAuthUser(user, plan),
    };
  }

  private async getPlanSummaryForUser(
    userId: number,
  ): Promise<AuthUserPlanSummary> {
    const row = await this.userSubscriptionRepository
      .createQueryBuilder('sub')
      .innerJoinAndSelect('sub.plan', 'plan')
      .select([
        'sub.id',
        'sub.planId',
        'sub.billingCycle',
        'sub.status',
        'sub.startedAt',
        'plan.id',
        'plan.slug',
        'plan.name',
      ])
      .where('sub.user_id = :userId', { userId })
      .andWhere('sub.status IN (:...statuses)', {
        statuses: ['active', 'trialing'],
      })
      .orderBy('sub.created_at', 'DESC')
      .limit(1)
      .getOne();

    if (!row?.plan) return null;

    return {
      id: row.id,
      planId: row.planId,
      planSlug: row.plan.slug,
      planName: row.plan.name,
      billingCycle: row.billingCycle,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
    };
  }

  private toPublicAuthUser(
    user: User,
    plan: AuthUserPlanSummary,
  ): AuthUserPayload {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      avatar: user.avatar ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      provider: user.provider ?? 'local',
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt ?? null,
      role: { id: user.role.id, name: user.role.name },
      plan,
    };
  }

  async resendOtp(email: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('This account is inactive.');
    }

    await this.sendOtpForUser(user);

    return { message: 'OTP sent successfully.' };
  }

  private async sendOtpForUser(user: User): Promise<void> {
    const code = String(randomInt(100_000, 1_000_000));
    const expiresInMinutes = 3;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    let otpRow = await this.otpRepository.findOne({
      where: { user: { id: user.id } },
    });
    if (otpRow) {
      otpRow.code = code;
      otpRow.isUsed = false;
      otpRow.expiresAt = expiresAt;
    } else {
      otpRow = this.otpRepository.create({
        user,
        code,
        isUsed: false,
        expiresAt,
      });
    }
    await this.otpRepository.save(otpRow);

    const subject = process.env.MAIL_OTP_SUBJECT ?? 'Your verification code';
    const html = await render(
      React.createElement(OtpEmail, {
        name: user.name,
        email: user.email,
        code,
        expiresInMinutes,
      }),
    );
    const text = `Hi ${user.name},\n\nYour verification code is: ${code}\n\nThis code expires in ${expiresInMinutes} minutes.`;
    await this.sendMail({
      to: user.email,
      subject,
      html,
      text,
    });
  }

  private async sendMail(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    try {
      await this.mailDelivery.sendHtmlEmail({
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        tags: ['auth', 'otp'],
      });
    } catch (error) {
      if (error instanceof BrevoSendFailedError) {
        throw new InternalServerErrorException(error.message);
      }
      throw error;
    }
  }

  private buildAccessPayload(user: User): JwtAccessPayload {
    return {
      sub: user.id,
      email: user.email,
      role: user.role.name,
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshTokenExpiresAt(): Date {
    const raw = process.env.JWT_REFRESH_EXPIRES_IN ?? '10d';
    const match = /^(\d+)([dhms])$/.exec(raw.trim());
    if (!match) {
      return new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2];
    const unitMs =
      unit === 'd'
        ? 24 * 60 * 60 * 1000
        : unit === 'h'
          ? 60 * 60 * 1000
          : unit === 'm'
            ? 60 * 1000
            : 1000;

    return new Date(Date.now() + amount * unitMs);
  }

  private signAccessToken(user: User): string {
    return this.jwtService.sign(this.buildAccessPayload(user));
  }

  private async createRefreshTokenForUser(userId: number): Promise<string> {
    const refreshToken = randomBytes(32).toString('hex');
    const record = this.refreshTokenRepository.create({
      tokenHash: this.hashRefreshToken(refreshToken),
      expiresAt: this.refreshTokenExpiresAt(),
      user: { id: userId } as User,
    });
    await this.refreshTokenRepository.save(record);
    return refreshToken;
  }

  private async issueAuthTokens(
    user: User,
  ): Promise<{ token: string; refreshToken: string }> {
    const token = this.signAccessToken(user);
    const refreshToken = await this.createRefreshTokenForUser(user.id);
    return { token, refreshToken };
  }

  async refreshAccessToken(
    rawToken: string,
  ): Promise<{ token: string; refreshToken: string }> {
    const tokenHash = this.hashRefreshToken(rawToken);
    const record = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
      relations: ['user', 'user.role'],
    });

    if (
      !record ||
      record.revokedAt != null ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const user = record.user;
    if (!user?.isActive) {
      throw new ForbiddenException('This account is inactive.');
    }

    record.revokedAt = new Date();
    await this.refreshTokenRepository.save(record);

    return this.issueAuthTokens(user);
  }

  async revokeRefreshToken(
    rawToken: string,
  ): Promise<{ message: string }> {
    const tokenHash = this.hashRefreshToken(rawToken);
    const record = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    if (record && record.revokedAt == null) {
      record.revokedAt = new Date();
      await this.refreshTokenRepository.save(record);
    }

    return { message: 'Logged out successfully.' };
  }

  async verifyOtp(
    verifyOtpDto: VerifyOtpDto,
  ): Promise<{
    message: string;
    token: string;
    refreshToken: string;
    user: AuthUserPayload;
  }> {
    const user = await this.validateAndConsumeOtp(
      verifyOtpDto.email,
      verifyOtpDto.otp,
    );

    if (!user.emailVerified) {
      user.emailVerified = true;
      await this.userRepository.save(user);
    }

    await this.trackOnboardingEvent({
      userId: user.id,
      eventName: 'otp_verified',
      idempotencyKey: `otp_verified:${user.id}`,
    });

    return {
      message: 'OTP verified successfully.',
      ...(await this.buildAuthSession(user)),
    };
  }

  async validateOtpForReset(
    verifyOtpDto: VerifyOtpDto,
  ): Promise<{ message: string }> {
    await this.validateOtpOnly(verifyOtpDto.email, verifyOtpDto.otp);

    return { message: 'OTP validated successfully.' };
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<{
    message: string;
    token: string;
    refreshToken: string;
    user: AuthUserPayload;
  }> {
    const user = await this.validateAndConsumeOtp(dto.email, dto.otp);

    user.passwordHash = await bcrypt.hash(dto.password, 10);
    user.emailVerified = true;
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return {
      message: 'Password reset successfully.',
      ...(await this.buildAuthSession(user)),
    };
  }

  private async validateOtpOnly(email: string, otp: number): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { email },
      relations: ['role'],
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('This account is inactive.');
    }

    const code = String(otp);
    const otpRecord = await this.otpRepository.findOne({
      where: { user: { id: user.id } },
    });
    if (!otpRecord || otpRecord.code !== code) {
      throw new UnauthorizedException('Invalid OTP.');
    }
    if (otpRecord.isUsed) {
      throw new UnauthorizedException('This OTP has already been used.');
    }

    const now = new Date();
    const expiresAt =
      otpRecord.expiresAt != null ? new Date(otpRecord.expiresAt) : null;
    if (expiresAt != null && expiresAt.getTime() < now.getTime()) {
      throw new UnauthorizedException('This OTP has expired.');
    }

    return user;
  }

  private async validateAndConsumeOtp(
    email: string,
    otp: number,
  ): Promise<User> {
    const user = await this.validateOtpOnly(email, otp);

    const otpRecord = await this.otpRepository.findOne({
      where: { user: { id: user.id } },
    });
    if (!otpRecord) {
      throw new UnauthorizedException('Invalid OTP.');
    }

    otpRecord.isUsed = true;
    await this.otpRepository.save(otpRecord);

    return user;
  }
}
