import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

export type CalendarOAuthSettings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  calendarId: string;
};

export function readCalendarOAuthSettings(): CalendarOAuthSettings {
  const clientId =
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    '';
  const clientSecret =
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    '';
  const redirectUri =
    process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() ||
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    '';
  const missing: string[] = [];
  if (!clientId) missing.push('GOOGLE_CALENDAR_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CALENDAR_CLIENT_SECRET');
  if (!redirectUri) missing.push('GOOGLE_CALENDAR_REDIRECT_URI');
  if (missing.length > 0) {
    throw new ServiceUnavailableException(`Missing ${missing.join(', ')}.`);
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    calendarId: process.env.GOOGLE_CALENDAR_ID?.trim() || 'primary',
  };
}

export const MEETING_HOST_EMAIL = 'sameeryasir02@gmail.com';

export function organizerEmail(): string {
  const email =
    process.env.GOOGLE_CALENDAR_ORGANIZER_EMAIL?.trim().toLowerCase();
  return email || MEETING_HOST_EMAIL;
}

export function signCalendarState(secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      exp: now + STATE_TTL_MS,
      n: createHash('sha256')
        .update(`${now}:${secret}`)
        .digest('hex')
        .slice(0, 16),
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function assertCalendarState(
  state: string,
  secret: string,
  now = Date.now(),
): void {
  const [payload, signature] = state.split('.');
  if (!payload || !signature || state.split('.').length !== 2) {
    throw new BadRequestException('This Google connection link is not valid.');
  }
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new BadRequestException('This Google connection link is not valid.');
  }
  let parsed: { exp?: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
    };
  } catch {
    throw new BadRequestException('This Google connection link is not valid.');
  }
  if (!parsed.exp || parsed.exp < now) {
    throw new BadRequestException(
      'This Google connection link has expired. Start the connection again.',
    );
  }
}

export function bookingKey(input: {
  email: string;
  start: string;
  end: string;
  timeZone: string;
}): string {
  return createHash('sha256')
    .update(
      [
        input.email.trim().toLowerCase(),
        input.start,
        input.end,
        input.timeZone,
      ].join('|'),
    )
    .digest('hex');
}

export function zonedDateTime(
  date: string,
  time: string,
  timeZone: string,
): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wallUtc = Date.UTC(year, month - 1, day, hour, minute);
  let offset = offsetMinutes(new Date(wallUtc), timeZone);
  let instant = wallUtc - offset * 60_000;
  const refined = offsetMinutes(new Date(instant), timeZone);
  if (refined !== offset) {
    offset = refined;
    instant = wallUtc - offset * 60_000;
  }
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  const offsetHour = String(Math.floor(absolute / 60)).padStart(2, '0');
  const offsetMinute = String(absolute % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${offsetHour}:${offsetMinute}`;
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const zonedAsUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return Math.round((zonedAsUtc - instant.getTime()) / 60_000);
}

export function addMinutes(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes));
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`,
    time: `${pad(next.getUTCHours())}:${pad(next.getUTCMinutes())}`,
  };
}

export function assertIsoRange(start: string, end: string): void {
  if (!isIsoWithZone(start) || !isIsoWithZone(end)) {
    throw new BadRequestException(
      'Start and end must be ISO 8601 times with a timezone.',
    );
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new BadRequestException('The end time must be after the start time.');
  }
}

export function toPublicCalendarError(error: unknown): HttpException {
  const status = readStatus(error);
  const rawDetail = readGoogleDetail(error);
  const detail = safeGoogleDetail(rawDetail);
  const grantRevoked = /invalid_grant|unauthorized/i.test(rawDetail);
  if (status === 401 || grantRevoked) {
    return new ServiceUnavailableException(
      'Google Calendar access has expired. An admin needs to connect the calendar again.',
    );
  }
  if (status === 403) {
    return new ServiceUnavailableException(
      'Google Calendar permission is missing. An admin needs to reconnect the calendar.',
    );
  }
  if (status === 404) {
    return new ServiceUnavailableException(
      'The connected Google Calendar could not be found. An admin needs to check the calendar and connect it again.',
    );
  }
  if (status === 429) {
    return new ServiceUnavailableException(
      'Google Calendar is busy right now. Please try again in a moment.',
    );
  }
  if (status === 400) {
    return new BadRequestException(
      detail
        ? `That meeting time could not be added to the calendar. ${detail}`
        : 'That meeting time could not be added to the calendar. Check the day, time, and time zone, then try again.',
    );
  }
  return new ServiceUnavailableException(
    detail
      ? `This meeting could not be added to the calendar. ${detail}`
      : 'This meeting could not be added to the calendar. Please try again.',
  );
}

function isIsoWithZone(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
    value,
  );
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { code?: number; response?: { status?: number } };
  return (
    record.response?.status ??
    (typeof record.code === 'number' ? record.code : null)
  );
}

function safeGoogleDetail(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 180) return '';
  if (/token|secret|password|bearer|refresh/i.test(cleaned)) return '';
  if (/^(error|bad request|conflict|internal server error)$/i.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function readGoogleDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as {
    message?: string;
    response?: {
      data?: {
        error?: { message?: string } | string;
        error_description?: string;
        message?: string;
      };
    };
  };
  const data = record.response?.data;
  const nested =
    typeof data?.error === 'string'
      ? data.error
      : data?.error?.message || data?.error_description || data?.message;
  return nested || record.message || '';
}
