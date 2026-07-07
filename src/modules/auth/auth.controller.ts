import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { User } from '../../db/entities/user.entity';
import { RegisterUserDto } from './authDto/register.dto';
import { AuthService } from './auth.service';
import { LoginUserDto } from './authDto/login.dto';
import { VerifyOtpDto } from './authDto/verify-otp.dto';
import { RefreshTokenDto } from './authDto/refresh-token.dto';
import { ResendOtpDto } from './authDto/resend-otp.dto';

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
  ): Promise<{
    message: string;
    token: string;
    refreshToken: string;
    user: User;
  }> {
    return await this.authService.loginUser(loginUserDto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-otp')
  async resendOtp(@Body() dto: ResendOtpDto): Promise<{ message: string }> {
    return this.authService.resendOtp(dto.email);
  }

  @Post('verify-otp')
  async verifyOtp(
    @Body() verifyOtpDto: VerifyOtpDto,
  ): Promise<{
    message: string;
    token: string;
    refreshToken: string;
    user: User;
  }> {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  refreshTokens(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshAccessToken(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.revokeRefreshToken(dto.refreshToken);
  }
}
