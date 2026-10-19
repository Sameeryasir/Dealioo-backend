import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes } from 'crypto';
import { google } from 'googleapis';
import { Repository } from 'typeorm';
import { GoogleCalendarConnection } from '../../db/entities/google-calendar-connection.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import {
  decryptSecret,
  encryptSecret,
} from '../../utils/token-encryption.util';
import {
  buildMeetingCalendarEvent,
  type CreatedCalendarEvent,
  upsertCalendarEvent,
} from './google-calendar-event';
import { CreateCalendarEventDto } from './create-calendar-event.dto';
import {
  assertCalendarState,
  assertIsoRange,
  bookingKey,
  organizerEmail,
  readCalendarOAuthSettings,
  toPublicCalendarError,
} from './google-calendar.util';

export type { CreatedCalendarEvent };

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    @InjectRepository(GoogleCalendarConnection)
    private readonly connectionRepo: Repository<GoogleCalendarConnection>,
  ) {}

  buildConnectUrl(): string {
    const settings = readCalendarOAuthSettings();
    const client = this.oauthClient(settings);
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [CALENDAR_SCOPE, 'openid', 'email'],
      state: this.signState(),
    });
  }

  async connectionStatus(): Promise<{
    connected: boolean;
    calendarId: string;
    organizerEmail: string | null;
  }> {
    const settings = readCalendarOAuthSettings();
    const refreshToken = await this.refreshToken();
    const saved = await this.savedConnection();
    return {
      connected: Boolean(refreshToken),
      calendarId: settings.calendarId,
      organizerEmail: organizerEmail() || saved?.googleEmail || null,
    };
  }

  async connectFromCallback(code: string, state: string): Promise<string> {
    assertCalendarState(state, this.stateSecret());
    const client = this.oauthClient(readCalendarOAuthSettings());
    let refreshToken = '';
    let email = '';
    try {
      const { tokens } = await client.getToken(code);
      refreshToken = tokens.refresh_token?.trim() || '';
      if (!refreshToken) {
        throw new BadRequestException(
          'Google did not return permission to add events later. Try connecting again.',
        );
      }
      client.setCredentials(tokens);
      const profile = await google
        .oauth2({ version: 'v2', auth: client })
        .userinfo.get();
      email = profile.data.email?.trim() || '';
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(
        `Google Calendar connect failed with status ${readStatus(error) ?? 'unknown'}`,
      );
      throw new BadRequestException(
        'Google Calendar was not connected. Start the connection again.',
      );
    }
    if (!email) {
      throw new BadRequestException(
        'Google did not share the account email for this calendar.',
      );
    }

    const row = (await this.savedConnection()) ?? this.connectionRepo.create();
    row.googleEmail = email;
    row.refreshToken = encryptSecret(refreshToken);
    row.calendarId = readCalendarOAuthSettings().calendarId;
    await this.connectionRepo.save(row);
    return email;
  }

  async createEvent(
    input: CreateCalendarEventDto,
  ): Promise<CreatedCalendarEvent> {
    assertIsoRange(input.start, input.end);
    try {
      Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(
        new Date(),
      );
    } catch {
      throw new BadRequestException('That time zone is not recognized.');
    }
    const timeZone = input.timeZone.trim();
    const key = bookingKey({
      email: input.attendeeEmail?.trim() || input.title.trim(),
      start: input.start,
      end: input.end,
      timeZone,
    });
    const visitor = input.attendeeEmail?.trim().toLowerCase() || '';
    const attendees = [organizerEmail(), visitor]
      .map((email) => email.trim())
      .filter(Boolean);
    return this.insertEvent({
      summary: input.title.trim(),
      description: input.description?.trim() || '',
      start: { dateTime: input.start, timeZone },
      end: { dateTime: input.end, timeZone },
      attendees: [...new Set(attendees)].map((email) => ({ email })),
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 10 }],
      },
      extendedProperties: {
        private: {
          source: 'dealioo',
          bookingKey: key,
          bookingVersion: '1',
        },
      },
      conferenceData: {
        createRequest: {
          requestId: key,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    });
  }

  async createMeetingEvent(
    meeting: MeetingRequest,
  ): Promise<CreatedCalendarEvent | null> {
    const refreshToken = await this.refreshToken();
    if (!refreshToken) {
      throw new ServiceUnavailableException(
        'Google Calendar is not connected, so this meeting was not added and no Meet link was created. An admin needs to connect the calendar, then book again.',
      );
    }
    if (
      !meeting.scheduledDate ||
      !meeting.scheduledTime ||
      !meeting.scheduledTimeZone ||
      !meeting.scheduledDuration
    ) {
      throw new BadRequestException('Pick an open meeting day and time.');
    }
    try {
      return await this.insertEvent(buildMeetingCalendarEvent(meeting));
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      if (error instanceof RangeError) {
        throw new BadRequestException('That time zone is not recognized.');
      }
      throw error;
    }
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      const calendar = await this.calendarClient();
      await calendar.events.delete({
        calendarId: readCalendarOAuthSettings().calendarId,
        eventId,
        sendUpdates: 'all',
      });
    } catch (error) {
      this.logger.error(
        `Could not remove calendar event after a failed booking. Status ${readStatus(error) ?? 'unknown'}`,
      );
    }
  }

  private async insertEvent(
    request: Parameters<typeof upsertCalendarEvent>[2],
  ): Promise<CreatedCalendarEvent> {
    try {
      const calendar = await this.calendarClient();
      return await upsertCalendarEvent(
        calendar.events,
        readCalendarOAuthSettings().calendarId,
        request,
      );
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      this.logger.error(
        `Google Calendar event was not created. Status ${readStatus(error) ?? 'unknown'}`,
      );
      throw toPublicCalendarError(error);
    }
  }

  private async calendarClient() {
    const refreshToken = await this.refreshToken();
    if (!refreshToken) {
      throw new ServiceUnavailableException(
        'GOOGLE_REFRESH_TOKEN is not set and no calendar account is connected.',
      );
    }
    const client = this.oauthClient(readCalendarOAuthSettings());
    client.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth: client });
  }

  private oauthClient(settings: ReturnType<typeof readCalendarOAuthSettings>) {
    return new google.auth.OAuth2(
      settings.clientId,
      settings.clientSecret,
      settings.redirectUri,
    );
  }

  private async refreshToken(): Promise<string | null> {
    const fromEnv = process.env.GOOGLE_REFRESH_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    const saved = await this.savedConnection();
    if (!saved?.refreshToken) return null;
    return decryptSecret(saved.refreshToken);
  }

  private async savedConnection(): Promise<GoogleCalendarConnection | null> {
    const [row] = await this.connectionRepo.find({
      order: { id: 'ASC' },
      take: 1,
    });
    return row ?? null;
  }

  private signState(): string {
    const payload = Buffer.from(
      JSON.stringify({
        exp: Date.now() + 10 * 60 * 1000,
        n: randomBytes(8).toString('hex'),
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', this.stateSecret())
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private stateSecret(): string {
    const secret = process.env.JWT_SECRET?.trim();
    if (!secret) {
      throw new ServiceUnavailableException('JWT_SECRET is not set.');
    }
    return secret;
  }
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { response?: { status?: number }; code?: number };
  return (
    record.response?.status ??
    (typeof record.code === 'number' ? record.code : null)
  );
}
