import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import type { GoogleAuthProfile } from '../interfaces/google-auth.interface';


@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const clientSecret = configService
      .get<string>('GOOGLE_CLIENT_SECRET')
      ?.trim();
    const callbackURL = configService
      .get<string>('GOOGLE_CALLBACK_URL')
      ?.trim();

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error(
        'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL must be set for Google login.',
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
      state: true,
      passReqToCallback: false,
    });

    this.logger.log('OAuth Started — GoogleStrategy configured');
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    try {
      const email = profile.emails?.[0]?.value?.trim().toLowerCase();
      if (!email) {
        this.logger.warn('OAuth Failed — Missing email from Google profile');
        done(
          new UnauthorizedException(
            'Google did not return an email address. Use another Google account or sign up with email.',
          ),
          undefined,
        );
        return;
      }

      const emailVerifiedRaw = (
        profile.emails?.[0] as { value?: string; verified?: boolean } | undefined
      )?.verified;
      if (emailVerifiedRaw === false) {
        this.logger.warn(`OAuth Failed — Unverified Google email: ${email}`);
        done(
          new UnauthorizedException(
            'Your Google email is not verified. Verify it with Google, then try again.',
          ),
          undefined,
        );
        return;
      }

      const googleId = profile.id?.trim();
      if (!googleId) {
        this.logger.warn('OAuth Failed — Missing Google subject id');
        done(
          new UnauthorizedException('Invalid Google profile (missing id).'),
          undefined,
        );
        return;
      }

      const firstName =
        profile.name?.givenName?.trim() ||
        profile.displayName?.trim().split(/\s+/)[0] ||
        'User';
      const lastName =
        profile.name?.familyName?.trim() ||
        profile.displayName?.trim().split(/\s+/).slice(1).join(' ') ||
        '';
      const avatar = profile.photos?.[0]?.value?.trim() || null;

      const result: GoogleAuthProfile = {
        googleId,
        email,
        emailVerified: true,
        firstName,
        lastName,
        avatar,
      };

      done(null, result);
    } catch (error) {
      this.logger.error('OAuth Failed — Unexpected Google strategy error', error);
      done(
        error instanceof Error
          ? error
          : new UnauthorizedException('Google authentication failed.'),
        undefined,
      );
    }
  }
}
