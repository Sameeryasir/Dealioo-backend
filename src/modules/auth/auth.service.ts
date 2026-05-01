import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import * as nodemailer from 'nodemailer';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { render } from '@react-email/render';
import * as React from 'react';
import { OtpEmail } from '../../templates/otp-email';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { Otp } from '../../db/entities/otp.entity';
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
    private readonly jwtService: JwtService,
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
    await this.sendMailWithGmail({
      to: user.email,
      subject,
      html,
      text,
    });
  }

  private createGmailTransport(): nodemailer.Transporter {
    const mailUser = process.env.MAIL_USER;
    const pass = process.env.MAIL_PASS;
    if (!mailUser?.trim() || !pass?.trim()) {
      throw new Error(
        'MAIL_USER and MAIL_PASS must be set for Gmail (Google account app password).',
      );
    }

    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user: mailUser, pass },
    });
  }

  private async sendMailWithGmail(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    const transporter = this.createGmailTransport();
    const from = process.env.MAIL_FROM?.trim() || process.env.MAIL_USER;

    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  }

  private buildAccessPayload(user: User): JwtAccessPayload {
    return {
      sub: user.id,
      email: user.email,
      role: user.role.name,
    };
  }

  async verifyOtp(
    verifyOtpDto: VerifyOtpDto,
  ): Promise<{ message: string; token: string; user: User }> {
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

    const token = this.jwtService.sign(this.buildAccessPayload(user));

    return { message: 'OTP verified successfully.', token, user };
  }
}
