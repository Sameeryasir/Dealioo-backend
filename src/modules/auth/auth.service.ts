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

    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const { token, refreshToken } = await this.issueAuthTokens(user);

    return {
      message: 'Login successful.',
      token,
      refreshToken,
      user,
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
