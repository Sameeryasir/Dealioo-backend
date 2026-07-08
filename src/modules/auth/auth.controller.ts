import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { User } from '../../db/entities/user.entity';
import { RegisterUserDto } from './authDto/register.dto';
import { AuthService } from './auth.service';
import { LoginUserDto } from './authDto/login.dto';
import { VerifyOtpDto } from './authDto/verify-otp.dto';
import { RefreshTokenDto } from './authDto/refresh-token.dto';
import { ResendOtpDto } from './authDto/resend-otp.dto';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleProfile } from './decorators/google-profile.decorator';
import type { GoogleAuthMode, GoogleAuthProfile } from './interfaces/google-auth.interface';

type GoogleCallbackRequest = Request & {
  googleOAuthError?: string;
  user?: GoogleAuthProfile;
  session?: { googleAuthMode?: GoogleAuthMode };
};

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

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

 
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth(): void {
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(
    @Req() req: GoogleCallbackRequest,
    @Res() res: Response,
    @GoogleProfile() profile: GoogleAuthProfile | undefined,
  ) {
    const mode: GoogleAuthMode =
      req.session?.googleAuthMode === 'signup' ? 'signup' : 'login';
    if (req.session) {
      delete req.session.googleAuthMode;
    }

    if (req.googleOAuthError) {
      return res.redirect(
        this.authService.buildGoogleErrorRedirect(
          req.googleOAuthError,
          mode === 'signup' ? '/auth/signup' : '/auth/login',
        ),
      );
    }

    const googleProfile = profile ?? req.user;
    if (!googleProfile?.email || !googleProfile?.googleId) {
      this.logger.warn('OAuth Failed — Missing Google profile after callback');
      return res.redirect(
        this.authService.buildGoogleErrorRedirect(
          'Could not complete Google sign-in. Missing profile data.',
          mode === 'signup' ? '/auth/signup' : '/auth/login',
        ),
      );
    }

    try {
      const { redirectUrl } = await this.authService.handleGoogleLogin(
        googleProfile,
        mode,
      );
      return res.redirect(redirectUrl);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unexpected error during Google sign-in.';
      this.logger.error(`OAuth Failed — ${message}`, error);
      return res.redirect(
        this.authService.buildGoogleErrorRedirect(
          message,
          this.authService.googleErrorPageFor(mode, error),
        ),
      );
    }
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
