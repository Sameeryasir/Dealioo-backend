import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type {
  GoogleAuthMode,
  GoogleAuthProfile,
} from './interfaces/google-auth.interface';
import { getFrontendBaseUrl, isAllowedCorsOrigin } from '../../utils/frontend-base-url';

type OAuthStatePayload = {
  n: string;
  m: GoogleAuthMode;
  t: number;
  f?: string;
};

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  private readonly maxAgeMs = 10 * 60 * 1000;
  private readonly clientID: string;
  private readonly clientSecret: string;
  private readonly callbackURL: string;
  private readonly stateSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.clientID =
      this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim() || '';
    this.clientSecret =
      this.configService.get<string>('GOOGLE_CLIENT_SECRET')?.trim() || '';
    this.callbackURL =
      this.configService.get<string>('GOOGLE_CALLBACK_URL')?.trim() || '';
    this.stateSecret =
      this.configService.get<string>('JWT_SECRET')?.trim() ||
      this.configService.get<string>('SESSION_SECRET')?.trim() ||
      'dealioo-oauth-session';

    if (!this.clientID || !this.clientSecret || !this.callbackURL) {
      throw new Error(
        'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL must be set for Google login.',
      );
    }
  }

  buildAuthorizationUrl(mode: GoogleAuthMode, returnOrigin?: string): string {
    const frontend = this.resolveFrontendOrigin(returnOrigin);
    const payload: OAuthStatePayload = {
      n: randomBytes(16).toString('hex'),
      m: mode,
      t: Date.now(),
      f: frontend,
    };
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url',
    );
    const state = `${body}.${this.sign(body)}`;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientID,
      redirect_uri: this.callbackURL,
      scope: 'email profile',
      state,
      prompt: 'select_account',
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  parseState(rawState: string | undefined): {
    ok: true;
    mode: GoogleAuthMode;
    frontend: string;
  } | {
    ok: false;
    message: string;
  } {
    if (!rawState?.includes('.')) {
      return {
        ok: false,
        message:
          'Google sign-in expired or was interrupted. Please try again.',
      };
    }

    const sep = rawState.lastIndexOf('.');
    const body = rawState.slice(0, sep);
    const sig = rawState.slice(sep + 1);
    if (!body || !sig || !this.signaturesMatch(sig, this.sign(body))) {
      return {
        ok: false,
        message: 'Invalid Google sign-in state. Please try again.',
      };
    }

    let payload: OAuthStatePayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as OAuthStatePayload;
    } catch {
      return {
        ok: false,
        message: 'Invalid Google sign-in state. Please try again.',
      };
    }

    if (
      typeof payload.t !== 'number' ||
      Date.now() - payload.t > this.maxAgeMs
    ) {
      return {
        ok: false,
        message:
          'Google sign-in expired or was interrupted. Please try again.',
      };
    }

    return {
      ok: true,
      mode: payload.m === 'signup' ? 'signup' : 'login',
      frontend: this.resolveFrontendOrigin(payload.f),
    };
  }

  async exchangeCodeForProfile(code: string): Promise<GoogleAuthProfile> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientID,
        client_secret: this.clientSecret,
        redirect_uri: this.callbackURL,
        grant_type: 'authorization_code',
      }),
    });

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenJson.access_token) {
      const detail =
        tokenJson.error_description ||
        tokenJson.error ||
        `HTTP ${tokenRes.status}`;
      this.logger.warn(`OAuth Failed — token exchange: ${detail}`);
      throw new Error(
        'Google sign-in could not be completed. Please try again.',
      );
    }

    const profileRes = await fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      },
    );
    const profileJson = (await profileRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      given_name?: string;
      family_name?: string;
      name?: string;
      picture?: string;
      error?: string;
      error_description?: string;
    };

    if (!profileRes.ok) {
      const detail =
        profileJson.error_description ||
        profileJson.error ||
        `HTTP ${profileRes.status}`;
      this.logger.warn(`OAuth Failed — userinfo: ${detail}`);
      throw new Error(
        'Google sign-in could not load your profile. Please try again.',
      );
    }

    const email = profileJson.email?.trim().toLowerCase();
    if (!email) {
      throw new Error(
        'Google did not return an email address. Use another Google account or sign up with email.',
      );
    }

    const emailVerified =
      profileJson.email_verified === true ||
      profileJson.email_verified === 'true';
    if (!emailVerified) {
      throw new Error(
        'Your Google email is not verified. Verify it with Google, then try again.',
      );
    }

    const googleId = profileJson.sub?.trim();
    if (!googleId) {
      throw new Error('Invalid Google profile (missing id).');
    }

    const firstName =
      profileJson.given_name?.trim() ||
      profileJson.name?.trim().split(/\s+/)[0] ||
      'User';
    const lastName =
      profileJson.family_name?.trim() ||
      profileJson.name?.trim().split(/\s+/).slice(1).join(' ') ||
      '';

    return {
      googleId,
      email,
      emailVerified: true,
      firstName,
      lastName,
      avatar: profileJson.picture?.trim() || null,
    };
  }

  private resolveFrontendOrigin(candidate?: string): string {
    const trimmed = candidate?.trim().replace(/\/$/, '');
    if (trimmed && isAllowedCorsOrigin(trimmed)) {
      return trimmed;
    }
    return getFrontendBaseUrl();
  }

  private sign(value: string): string {
    return createHmac('sha256', this.stateSecret)
      .update(value)
      .digest('base64url');
  }

  private signaturesMatch(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) {
      return false;
    }
    return timingSafeEqual(aBuf, bBuf);
  }
}
