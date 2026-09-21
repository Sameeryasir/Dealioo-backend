import type { CookieOptions, Response } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

function durationMs(raw: string | undefined, fallbackMs: number): number {
  const match = /^(\d+)([dhms])$/.exec((raw ?? '').trim());
  if (!match) return fallbackMs;
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
  return amount * unitMs;
}

function authCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(
    ACCESS_TOKEN_COOKIE,
    accessToken,
    authCookieOptions(
      durationMs(
        process.env.JWT_ACCESS_EXPIRES_IN ?? process.env.JWT_EXPIRES_IN,
        15 * 60 * 1000,
      ),
    ),
  );
  res.cookie(
    REFRESH_TOKEN_COOKIE,
    refreshToken,
    authCookieOptions(
      durationMs(
        process.env.JWT_REFRESH_EXPIRES_IN,
        10 * 24 * 60 * 60 * 1000,
      ),
    ),
  );
}

export function clearAuthCookies(res: Response): void {
  const options = authCookieOptions(0);
  res.clearCookie(ACCESS_TOKEN_COOKIE, options);
  res.clearCookie(REFRESH_TOKEN_COOKIE, options);
  res.clearCookie('dealioo_access', options);
  res.clearCookie('dealioo_refresh', options);
}

export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return null;
}

export function withoutAuthTokens<T extends { token?: string; refreshToken?: string }>(
  body: T,
): Omit<T, 'token' | 'refreshToken'> {
  const rest = { ...body };
  delete rest.token;
  delete rest.refreshToken;
  return rest;
}
