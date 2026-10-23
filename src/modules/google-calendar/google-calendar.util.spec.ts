import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  assertCalendarState,
  assertIsoRange,
  bookingKey,
  readCalendarOAuthSettings,
  signCalendarState,
  toPublicCalendarError,
} from './google-calendar.util';

describe('google calendar oauth', () => {
  const secret = 'calendar-state-secret';

  afterEach(() => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.GOOGLE_CALENDAR_ID;
  });

  it('accepts a signed state and rejects a changed one', () => {
    const state = signCalendarState(secret, 1_000);
    expect(() => assertCalendarState(state, secret, 1_000)).not.toThrow();
    expect(() => assertCalendarState(`${state}x`, secret, 1_000)).toThrow(
      BadRequestException,
    );
  });

  it('rejects an expired state', () => {
    const state = signCalendarState(secret, 1_000);
    expect(() =>
      assertCalendarState(state, secret, 1_000 + 11 * 60 * 1000),
    ).toThrow(/expired/i);
  });

  it('names the missing calendar settings', () => {
    expect(() => readCalendarOAuthSettings()).toThrow(
      ServiceUnavailableException,
    );
    expect(() => readCalendarOAuthSettings()).toThrow(
      'GOOGLE_CALENDAR_CLIENT_ID',
    );
  });

  it('rejects a meeting that ends before it starts', () => {
    expect(() =>
      assertIsoRange('2026-10-21T10:00:00-05:00', '2026-10-21T09:00:00-05:00'),
    ).toThrow(/end time/i);
  });

  it('rejects a time that has no timezone', () => {
    expect(() =>
      assertIsoRange('2026-10-21T10:00:00', '2026-10-21T10:30:00'),
    ).toThrow(/timezone/i);
  });

  it('uses the same booking key when the same request is sent again', () => {
    const input = {
      email: 'Visitor@Example.com',
      start: '2026-10-21T10:00:00',
      end: '2026-10-21T10:30:00',
      timeZone: 'America/Chicago',
    };
    expect(bookingKey(input)).toBe(
      bookingKey({ ...input, email: 'visitor@example.com' }),
    );
  });

  it('hides Google failure details from the visitor', () => {
    const revoked = toPublicCalendarError({
      response: { status: 401 },
      message: 'invalid_grant refresh token raw-secret',
    });
    expect(revoked.message).toMatch(/expired/i);
    expect(revoked.message).not.toMatch(/raw-secret/);

    const busy = toPublicCalendarError({ response: { status: 429 } });
    expect(busy.message).toMatch(/busy/i);

    const denied = toPublicCalendarError({ response: { status: 403 } });
    expect(denied).toBeInstanceOf(ServiceUnavailableException);
  });
});
