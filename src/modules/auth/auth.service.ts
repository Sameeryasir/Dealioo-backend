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
import { Repository } from 'typeorm';
import { BrevoSendFailedError } from '../mail/brevo-mail.errors';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { JwtService } from '@nestjs/jwt';
import { render } from '@react-email/render';
import * as React from 'react';
import { OtpEmail } from '../../templates/otp-email';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { Otp } from '../../db/entities/otp.entity';
import { RefreshToken } from '../../db/entities/refresh-token.entity';
import { RegisterUserDto } from './authDto/register.dto';
import { LoginUserDto } from './authDto/login.dto';
import { JwtAccessPayload } from './jwt/jwt-access-payload.interface';
import { VerifyOtpDto } from './authDto/verify-otp.dto';
import type {
  GoogleAuthMode,
  GoogleAuthProfile,
  GoogleAuthResult,
} from './interfaces/google-auth.interface';
import { getFrontendBaseUrl } from '../../utils/frontend-base-url';

/** Default role for Google self-signup (mirrors restaurant owner register). */
const GOOGLE_SIGNUP_ROLE = 'Admin';

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
    private readonly jwtService: JwtService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly configService: ConfigService,
  ) {}

  async createUser(
    registerUserDto: RegisterUserDto,
  ): Promise<{ message: string }> {
    const existingByEmail = await this.userRepository.findOne({
      where: { email: registerUserDto.email },
    });
  
    if (existingByEmail) {
      throw new ConflictException('An account with this email already exists.');
    }
  
    const role = await this.roleRepository.findOne({
      where: { name: registerUserDto.role },
    });
  
    if (!role) {
      throw new NotFoundException(
        `Role '${registerUserDto.role}' does not exist.`,
      );
    }
  
    const passwordHash = await bcrypt.hash(registerUserDto.password, 10);
  
    const user = this.userRepository.create({
      email: registerUserDto.email,
      name: registerUserDto.name,
      phone: registerUserDto.phone,
      passwordHash,
      role,
    });
  
    const savedUser = await this.userRepository.save(user);
  
    await this.sendOtpForUser(savedUser);
  
    return {
      message: 'User successfully registered.',
    };
  }

  async loginUser(
    loginUserDto: LoginUserDto,
  ): Promise<{
    message: string;
    token: string;
    refreshToken: string;
    user: User;
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
        emailVerified: true,
        phoneVerified: true,
        passwordHash: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        role: { id: true, name: true },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (!user.isActive) {
      throw new ForbiddenException('This account is inactive.');
    }

    // Google-only accounts have no password — block password login clearly.
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

    const { token, refreshToken } = await this.issueAuthTokens(user);

    return {
      message: 'Login successful.',
      token,
      refreshToken,
      user,
    };
  }

 
  async handleGoogleLogin(
    profile: GoogleAuthProfile,
    mode: GoogleAuthMode = 'login',
  ): Promise<{ redirectUrl: string }> {
    this.logger.log(
      `OAuth Started — Google ${mode} for ${profile.email}`,
    );

    try {
      const { user, isNewUser } = await this.resolveGoogleUser(profile, mode);
      const tokens = await this.issueAuthTokens(user);

      this.logger.log(
        isNewUser
          ? `User Created — Google user id=${user.id} email=${user.email}`
          : `User Logged In — Google user id=${user.id} email=${user.email}`,
      );
      this.logger.log(`OAuth Success — user id=${user.id}`);

      const result: GoogleAuthResult = {
        accessToken: tokens.token,
        refreshToken: tokens.refreshToken,
        isNewUser,
        user: this.toGoogleAuthUser(user),
      };

      return { redirectUrl: this.buildGoogleFrontendRedirect(result) };
    } catch (error) {
      this.logger.error(
        `OAuth Failed — Google ${mode} for ${profile.email}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  buildGoogleFrontendRedirect(result: GoogleAuthResult): string {
    const frontend =
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
  ): string {
    const frontend =
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

    const role = await this.roleRepository.findOne({
      where: { name: GOOGLE_SIGNUP_ROLE },
    });
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

  private toGoogleAuthUser(user: User): GoogleAuthResult['user'] {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      phone: user.phone,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      isActive: user.isActive,
      provider: user.provider,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: { id: user.role.id, name: user.role.name },
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
    user: User;
  }> {
    const { email, otp } = verifyOtpDto;
    const user = await this.userRepository.findOne({
      where: { email },
      relations: ['role'],
    });
    if (!user) {
      throw new NotFoundException('User not found.');
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

    otpRecord.isUsed = true;
    await this.otpRepository.save(otpRecord);

    if (!user.emailVerified) {
      user.emailVerified = true;
      await this.userRepository.save(user);
    }

    const { token, refreshToken } = await this.issueAuthTokens(user);

    return {
      message: 'OTP verified successfully.',
      token,
      refreshToken,
      user,
    };
  }
}
