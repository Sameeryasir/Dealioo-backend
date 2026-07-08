import {
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { GoogleAuthMode } from '../interfaces/google-auth.interface';

type GoogleSession = {
  googleAuthMode?: GoogleAuthMode;
};

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleAuthGuard.name);

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      query?: Record<string, string>;
      googleOAuthError?: string;
      session?: GoogleSession;
    }>();

    const oauthError = request.query?.error?.trim();
    if (oauthError) {
      const description = request.query?.error_description?.trim();
      request.googleOAuthError =
        description ||
        (oauthError === 'access_denied'
          ? 'Google sign-in was cancelled.'
          : `Google sign-in failed (${oauthError}).`);
      this.logger.warn(`OAuth Failed — ${request.googleOAuthError}`);
      return true;
    }

    // OAuth start — remember whether user clicked login or signup.
    const isCallback = Boolean(request.query?.code?.trim());
    if (!isCallback && request.session) {
      const rawMode = request.query?.mode?.trim().toLowerCase();
      request.session.googleAuthMode =
        rawMode === 'signup' ? 'signup' : 'login';
    }

    return super.canActivate(context);
  }
}
