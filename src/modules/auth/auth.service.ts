import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
import { SetupPasswordDto } from './authDto/setup-password.dto';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';

@Injectable()
export class AuthService {
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
  ) {}

  async setupPassword(
    userId: number,
    dto: SetupPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: {
        passwordHash: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const currentOk = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentOk) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(
        'New password must be different from your current password.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepository.update(userId, { passwordHash });

    return { message: 'Password updated successfully.' };
  }

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
  ): Promise<{ message: string }> {
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
  
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
  
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }
  
    await this.sendOtpForUser(user);
  
    return {
      message: 'OTP sent successfully',
    };
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

    const { token, refreshToken } = await this.issueAuthTokens(user);

    return {
      message: 'OTP verified successfully.',
      token,
      refreshToken,
      user,
    };
  }

  async generateTwoFactorSecret(userId: number) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    const secret = speakeasy.generateSecret({
      name: `Restaurant Admin (${user.email})`,
      issuer: 'Restaurant Admin App',
    });

    await this.userRepository.update(user.id, {
      twoFactorSecret: secret.base32,
      twoFactorEnabled: false,
    });

    const qrCode = await qrcode.toDataURL(secret.otpauth_url!);

    return {
      qrCode,
      message: 'Scan this QR code using Google Authenticator.',
    };
  }

  async verifyTwoFactorSetup(
    userId: number,
    code: string,
  ): Promise<{ message: string; twoFactorEnabled: boolean }> {
    const id = Number(userId);
    if (!Number.isFinite(id) || id < 1) {
      throw new BadRequestException('Invalid user.');
    }

    const user = await this.userRepository.findOne({
      where: { id },
      select: {
        id: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (!user.twoFactorSecret) {
      throw new BadRequestException(
        'No two-factor secret found. Generate one first.',
      );
    }

    if (user.twoFactorEnabled) {
      return {
        message: 'Two-factor authentication is already enabled.',
        twoFactorEnabled: true,
      };
    }

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 2,
    });

    if (!valid) {
      throw new UnauthorizedException('Invalid two-factor code.');
    }

    const updateResult = await this.userRepository.update(
      { id },
      { twoFactorEnabled: true },
    );

    if (!updateResult.affected) {
      throw new BadRequestException(
        'Could not save two-factor settings. Try again.',
      );
    }

    return {
      message: 'Two-factor authentication enabled successfully.',
      twoFactorEnabled: true,
    };
  }
}
