import { Body, Controller, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { User } from '../../db/entities/user.entity';
import { RegisterUserDto } from './authDto/register.dto';
import { AuthService } from './auth.service';
import { LoginUserDto } from './authDto/login.dto';
import { VerifyOtpDto } from './authDto/verify-otp.dto';
import { VerifyTwoFactorDto } from './authDto/verify-2fa.dto';
import { SetupPasswordDto } from './authDto/setup-password.dto';
import { JwtAuthGuard } from './jwt/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async registerUsers(
    @Body() registerUserDto: RegisterUserDto,
  ): Promise<{ message: string }> {
    return await this.authService.createUser(registerUserDto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async loginUsers(
    @Body() loginUserDto: LoginUserDto,
  ): Promise<{ message: string }> {
    return await this.authService.loginUser(loginUserDto);
  }
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Put('setup-password')
  setupPassword(
    @Req() req: { user: { id: number } },
    @Body() dto: SetupPasswordDto,
  ) {
    return this.authService.setupPassword(req.user.id, dto);
  }

  @Post('verify-otp')
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
  ): Promise<{ message: string; token: string; user: User }> {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  generateTwoFactorSecret(@Req() req: { user: { id: number } }) {
    return this.authService.generateTwoFactorSecret(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify-setup')
  verifyTwoFactorSetup(
    @Req() req: { user: { id: number } },
    @Body() dto: VerifyTwoFactorDto,
  ) {
    return this.authService.verifyTwoFactorSetup(req.user.id, dto.code);
  }
}
