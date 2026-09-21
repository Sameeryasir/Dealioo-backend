import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { RegisterUserDto } from './authDto/register.dto';
import { RegisterWithInvitationDto } from './authDto/register-with-invitation.dto';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { LoginUserDto } from './authDto/login.dto';
import { VerifyOtpDto } from './authDto/verify-otp.dto';
import { RefreshTokenDto } from './authDto/refresh-token.dto';
import { ResendOtpDto } from './authDto/resend-otp.dto';
import { ResetPasswordDto } from './authDto/reset-password.dto';
import type { GoogleAuthMode } from './interfaces/google-auth.interface';
import { AcceptInvitationDto } from '../invitation/invitationDto/accept-invitation.dto';
import {
  clearAuthCookies,
  REFRESH_TOKEN_COOKIE,
  readCookie,
  setAuthCookies,
  withoutAuthTokens,
} from './auth-cookies';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuthService: GoogleOAuthService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  async registerUsers(
    @Body() registerUserDto: RegisterUserDto,
  ): Promise<{ message: string; isNewCustomer: boolean }> {
    return await this.authService.createUser(registerUserDto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register-with-invitation')
  async registerWithInvitation(
    @Body() dto: RegisterWithInvitationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.registerWithInvitation(dto);
    setAuthCookies(res, result.token, result.refreshToken);
    return withoutAuthTokens(result);
  }

  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept-invitation')
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request & {
      user: { id: number; email: string; role?: { name: string } | null };
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.acceptBusinessInvitation(
      dto.token,
      req.user,
    );
    setAuthCookies(res, result.token, result.refreshToken);
    return withoutAuthTokens(result);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async loginUsers(
    @Body() loginUserDto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginUser(loginUserDto);
    setAuthCookies(res, result.token, result.refreshToken);
    return withoutAuthTokens(result);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('google')
  googleAuth(
    @Query('mode') modeRaw: string | undefined,
    @Query('returnOrigin') returnOrigin: string | undefined,
    @Res() res: Response,
  ) {
    const mode: GoogleAuthMode =
      modeRaw?.trim().toLowerCase() === 'signup' ? 'signup' : 'login';
    const url = this.googleOAuthService.buildAuthorizationUrl(
      mode,
      returnOrigin,
    );
    return res.redirect(302, url);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('google/callback')
  async googleAuthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Query('error_description') oauthErrorDescription: string | undefined,
    @Res() res: Response,
  ) {
    const parsed = this.googleOAuthService.parseState(state);
    const mode: GoogleAuthMode = parsed.ok ? parsed.mode : 'login';
    const frontend = parsed.ok ? parsed.frontend : undefined;

    if (oauthError) {
      const message =
        oauthErrorDescription?.trim() ||
        (oauthError === 'access_denied'
          ? 'Google sign-in was cancelled.'
          : `Google sign-in failed (${oauthError}).`);
      this.logger.warn(`OAuth Failed — ${message}`);
      return res.redirect(
        this.authService.buildGoogleErrorRedirect(
          message,
          mode === 'signup' ? '/auth/signup' : '/auth/login',
          frontend,
        ),
      );
    }

    if (!parsed.ok) {
      this.logger.warn(`OAuth Failed — ${parsed.message}`);
      return res.redirect(
        this.authService.buildGoogleErrorRedirect(
          parsed.message,
          '/auth/login',
          frontend,
        ),
      );
    }

    if (!code?.trim()) {
      return res.redirect(
        this.authService.buildGoogleErrorRedirect(
          'Google sign-in did not return an authorization code. Please try again.',
          mode === 'signup' ? '/auth/signup' : '/auth/login',
          frontend,
        ),
      );
    }

    try {
      const profile = await this.googleOAuthService.exchangeCodeForProfile(
        code.trim(),
      );
      const { redirectUrl, accessToken, refreshToken } =
        await this.authService.handleGoogleLogin(profile, mode, frontend);
      setAuthCookies(res, accessToken, refreshToken);
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
          frontend,
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
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyOtp(verifyOtpDto);
    setAuthCookies(res, result.token, result.refreshToken);
    return withoutAuthTokens(result);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('validate-otp')
  async validateOtpForReset(
    @Body() verifyOtpDto: VerifyOtpDto,
  ): Promise<{ message: string }> {
    return this.authService.validateOtpForReset(verifyOtpDto);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.resetPassword(dto);
    setAuthCookies(res, result.token, result.refreshToken);
    return withoutAuthTokens(result);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  async refreshTokens(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
      dto.refreshToken?.trim() ||
      readCookie(req.headers.cookie, REFRESH_TOKEN_COOKIE) ||
      '';
    const result = await this.authService.refreshAccessToken(refreshToken);
    setAuthCookies(res, result.token, result.refreshToken);
    return withoutAuthTokens(result);
  }

  @Post('logout')
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
      dto.refreshToken?.trim() ||
      readCookie(req.headers.cookie, REFRESH_TOKEN_COOKIE) ||
      '';
    const result = refreshToken
      ? await this.authService.revokeRefreshToken(refreshToken)
      : { message: 'Logged out successfully.' };
    clearAuthCookies(res);
    return result;
  }
}
