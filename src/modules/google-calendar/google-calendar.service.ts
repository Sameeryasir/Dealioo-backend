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
import { decryptSecret, encryptSecret } from '../../utils/token-encryption.util';
import { CreateCalendarEventDto } from './create-calendar-event.dto';
import {
  addMinutes,
  assertCalendarState,
  assertIsoRange,
  bookingKey,
  organizerEmail,
  readCalendarOAuthSettings,
  toPublicCalendarError,
} from './google-calendar.util';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export type CreatedCalendarEvent = {
  eventId: string;
  htmlLink: string | null;
  meetLink: string | null;
  created: boolean;
};

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
      this.logger.error(`Google Calendar connect failed with status ${readStatus(error) ?? 'unknown'}`);
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

  async createEvent(input: CreateCalendarEventDto): Promise<CreatedCalendarEvent> {
    assertIsoRange(input.start, input.end);
    try {
      Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(new Date());
    } catch {
      throw new BadRequestException('That time zone is not recognized.');
    }
    return this.insertEvent({
      title: input.title.trim(),
      description: input.description?.trim() || '',
      start: input.start,
      end: input.end,
      timeZone: input.timeZone.trim(),
      attendeeEmail: input.attendeeEmail?.trim().toLowerCase(),
      bookingKey: bookingKey({
        email: input.attendeeEmail?.trim() || input.title.trim(),
        start: input.start,
        end: input.end,
        timeZone: input.timeZone.trim(),
      }),
    });
  }

  async createMeetingEvent(
    meeting: MeetingRequest,
  ): Promise<CreatedCalendarEvent | null> {
    const refreshToken = await this.refreshToken();
    if (!refreshToken) {
      this.logger.warn(
        'Google Calendar is not connected. The meeting will be saved without a calendar event.',
      );
      return null;
    }
    if (
      !meeting.scheduledDate ||
      !meeting.scheduledTime ||
      !meeting.scheduledTimeZone ||
      !meeting.scheduledDuration
    ) {
      throw new BadRequestException('Pick an open meeting day and time.');
    }
    const end = addMinutes(
      meeting.scheduledDate,
      meeting.scheduledTime,
      meeting.scheduledDuration,
    );
    const start = `${meeting.scheduledDate}T${meeting.scheduledTime}:00`;
    const endValue = `${end.date}T${end.time}:00`;
    const visitorName = `${meeting.firstName} ${meeting.lastName}`.trim();
    const place = [meeting.cityLocation, meeting.state, meeting.country]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', ');
    return this.insertEvent({
      title: `${visitorName} · ${meeting.businessName}`.trim(),
      location: place,
      description: [
        visitorName,
        meeting.email,
        meeting.phone,
        meeting.businessName,
        meeting.businessCategory ? `Business type: ${meeting.businessCategory}` : '',
        meeting.businessPhone ? `Business phone: ${meeting.businessPhone}` : '',
        meeting.businessEmail ? `Business email: ${meeting.businessEmail}` : '',
        meeting.website ? `Website: ${meeting.website}` : '',
        place ? `Location: ${place}` : '',
        meeting.description ? meeting.description : '',
        `Host: ${organizerEmail()}`,
      ]
        .filter(Boolean)
        .join('\n'),
      start,
      end: endValue,
      timeZone: meeting.scheduledTimeZone,
      attendeeEmail: meeting.email.trim().toLowerCase(),
      bookingKey: bookingKey({
        email: meeting.email,
        start,
        end: endValue,
        timeZone: meeting.scheduledTimeZone,
      }),
    });
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

  private async insertEvent(input: {
    title: string;
    description: string;
    location?: string;
    start: string;
    end: string;
    timeZone: string;
    attendeeEmail?: string;
    bookingKey: string;
  }): Promise<CreatedCalendarEvent> {
    try {
      const calendar = await this.calendarClient();
      const calendarId = readCalendarOAuthSettings().calendarId;
      const existing = await calendar.events.list({
        calendarId,
        privateExtendedProperty: [`bookingKey=${input.bookingKey}`],
        maxResults: 1,
        singleEvents: true,
      });
      const found = existing.data.items?.[0];
      if (found?.id) {
        const existingMeetLink = meetLinkFromEvent(found);
        if (existingMeetLink) {
          return {
            eventId: found.id,
            htmlLink: found.htmlLink ?? null,
            meetLink: existingMeetLink,
            created: false,
          };
        }
        const patched = await calendar.events.patch({
          calendarId,
          eventId: found.id,
          conferenceDataVersion: 1,
          sendUpdates: 'all',
          requestBody: {
            conferenceData: meetConference(input.bookingKey),
          },
        });
        return {
          eventId: found.id,
          htmlLink: patched.data.htmlLink ?? found.htmlLink ?? null,
          meetLink: requireMeetLink(patched.data),
          created: false,
        };
      }
      const inserted = await calendar.events.insert({
        calendarId,
        conferenceDataVersion: 1,
        sendUpdates: 'all',
        requestBody: {
          summary: input.title,
          description: input.description,
          location: input.location || undefined,
          start: { dateTime: input.start, timeZone: input.timeZone },
          end: { dateTime: input.end, timeZone: input.timeZone },
          attendees: meetingAttendees(input.attendeeEmail),
          reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: 10 }],
          },
          extendedProperties: {
            private: { bookingKey: input.bookingKey },
          },
          conferenceData: meetConference(input.bookingKey),
        },
      });
      if (!inserted.data.id) {
        throw new ServiceUnavailableException(
          'This meeting could not be added to the calendar. Please try again.',
        );
      }
      return {
        eventId: inserted.data.id,
        htmlLink: inserted.data.htmlLink ?? null,
        meetLink: requireMeetLink(inserted.data),
        created: true,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
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

function meetingAttendees(visitorEmail?: string) {
  const emails = [organizerEmail(), visitorEmail?.trim().toLowerCase() || '']
    .map((email) => email.trim())
    .filter(Boolean);
  return [...new Set(emails)].map((email) => ({ email }));
}

function meetConference(bookingKey: string) {
  return {
    createRequest: {
      requestId: bookingKey,
      conferenceSolutionKey: { type: 'hangoutsMeet' },
    },
  };
}

function meetLinkFromEvent(event: {
  hangoutLink?: string | null;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string | null; uri?: string | null }> | null;
  } | null;
}): string | null {
  const hangout = event.hangoutLink?.trim();
  if (hangout) return hangout;
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video' && entry.uri?.trim(),
  );
  return video?.uri?.trim() || null;
}

function requireMeetLink(event: {
  hangoutLink?: string | null;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string | null; uri?: string | null }> | null;
  } | null;
}): string {
  const link = meetLinkFromEvent(event);
  if (!link) {
    throw new ServiceUnavailableException(
      'The Google Meet link could not be created. Please try again.',
    );
  }
  return link;
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { response?: { status?: number }; code?: number };
  return record.response?.status ?? (typeof record.code === 'number' ? record.code : null);
}
