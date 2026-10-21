import { ServiceUnavailableException } from '@nestjs/common';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import {
  addMinutes,
  bookingKey,
  organizerEmail,
  zonedDateTime,
} from './google-calendar.util';

export type CreatedCalendarEvent = {
  eventId: string;
  htmlLink: string | null;
  meetLink: string | null;
  created: boolean;
};

export type CalendarEventRequest = {
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: Array<{ email: string }>;
  reminders: {
    useDefault: false;
    overrides: Array<{ method: 'popup'; minutes: number }>;
  };
  extendedProperties: { private: Record<string, string> };
  conferenceData: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: { type: 'hangoutsMeet' };
    };
  };
};

type CalendarEventResource = {
  id?: string | null;
  htmlLink?: string | null;
  hangoutLink?: string | null;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: string | null;
      uri?: string | null;
    }> | null;
  } | null;
  extendedProperties?: { private?: Record<string, string> | null } | null;
};

type CalendarEventsApi = {
  list: (params: {
    calendarId: string;
    privateExtendedProperty: string[];
    maxResults: number;
    singleEvents: boolean;
  }) => Promise<{ data: { items?: CalendarEventResource[] } }>;
  patch: (params: {
    calendarId: string;
    eventId: string;
    conferenceDataVersion?: number;
    sendUpdates: 'all';
    requestBody: ReturnType<typeof calendarWriteBody>;
  }) => Promise<{ data: CalendarEventResource }>;
  insert: (params: {
    calendarId: string;
    conferenceDataVersion: number;
    sendUpdates: 'all';
    requestBody: ReturnType<typeof calendarWriteBody>;
  }) => Promise<{ data: CalendarEventResource }>;
};

export function buildMeetingCalendarEvent(
  meeting: MeetingRequest,
): CalendarEventRequest {
  const timeZone = meeting.scheduledTimeZone || '';
  const start = zonedDateTime(
    meeting.scheduledDate || '',
    meeting.scheduledTime || '',
    timeZone,
  );
  const endClock = addMinutes(
    meeting.scheduledDate || '',
    meeting.scheduledTime || '',
    meeting.scheduledDuration || 0,
  );
  const end = zonedDateTime(endClock.date, endClock.time, timeZone);
  const key = bookingKey({
    email: meeting.email,
    start,
    end,
    timeZone,
  });
  const visitorName = `${meeting.firstName} ${meeting.lastName}`.trim();
  const privateProps: Record<string, string> = {
    source: 'dealioo',
    bookingKey: key,
    bookingVersion: '1',
  };
  if (Number.isInteger(meeting.id) && meeting.id > 0) {
    privateProps.meetingRequestId = String(meeting.id);
  }
  const firstName = text(meeting.firstName);
  const lastName = text(meeting.lastName);
  const visitorEmail = text(meeting.email)?.toLowerCase() || '';
  if (firstName) privateProps.visitorFirstName = firstName;
  if (lastName) privateProps.visitorLastName = lastName;
  if (visitorName) privateProps.visitorFullName = visitorName;
  if (visitorEmail) privateProps.visitorEmail = visitorEmail;

  return {
    summary:
      `Dealioo Meeting | ${visitorName} | ${meeting.businessName}`.trim(),
    description: meetingDescription(meeting, { start, end, timeZone }),
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    attendees: meetingAttendees(meeting.email),
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: 10 }],
    },
    extendedProperties: { private: privateProps },
    conferenceData: {
      createRequest: {
        requestId: key,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };
}

export function calendarWriteBody(
  request: CalendarEventRequest,
  includeConference: boolean,
) {
  const body = {
    summary: request.summary,
    description: request.description,
    start: request.start,
    end: request.end,
    attendees: request.attendees,
    reminders: request.reminders,
    extendedProperties: request.extendedProperties,
  };
  if (!includeConference) return body;
  return { ...body, conferenceData: request.conferenceData };
}

export function readPrivateBookingMetadata(event: CalendarEventResource): {
  source: string;
  bookingKey: string;
  meetingRequestId: string;
  bookingVersion: string;
} {
  const stored = event.extendedProperties?.private ?? {};
  return {
    source: stored.source ?? '',
    bookingKey: stored.bookingKey ?? '',
    meetingRequestId: stored.meetingRequestId ?? '',
    bookingVersion: stored.bookingVersion ?? '',
  };
}

export async function upsertCalendarEvent(
  events: CalendarEventsApi,
  calendarId: string,
  request: CalendarEventRequest,
): Promise<CreatedCalendarEvent> {
  const key = request.extendedProperties.private.bookingKey;
  const existing = await events.list({
    calendarId,
    privateExtendedProperty: [`bookingKey=${key}`],
    maxResults: 1,
    singleEvents: true,
  });
  const found = existing.data.items?.[0];
  if (found?.id) {
    const existingMeetLink = meetLinkFromEvent(found);
    const patched = await events.patch({
      calendarId,
      eventId: found.id,
      ...(existingMeetLink ? {} : { conferenceDataVersion: 1 }),
      sendUpdates: 'all',
      requestBody: calendarWriteBody(request, !existingMeetLink),
    });
    const meetLink = meetLinkFromEvent(patched.data) || existingMeetLink;
    if (!meetLink) {
      throw new ServiceUnavailableException(
        'The Google Meet link could not be created. Please try again.',
      );
    }
    return {
      eventId: found.id,
      htmlLink: patched.data.htmlLink ?? found.htmlLink ?? null,
      meetLink,
      created: false,
    };
  }

  const inserted = await events.insert({
    calendarId,
    conferenceDataVersion: 1,
    sendUpdates: 'all',
    requestBody: calendarWriteBody(request, true),
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
}

function meetingDescription(
  meeting: MeetingRequest,
  schedule: { start: string; end: string; timeZone: string },
): string {
  const sections = [
    section('Meeting information', [
      field('Booking ID', meeting.id),
      field('Starts', schedule.start),
      field('Ends', schedule.end),
      field('Time zone', schedule.timeZone),
      field(
        'Duration',
        meeting.scheduledDuration ? `${meeting.scheduledDuration} minutes` : '',
      ),
      field('Host email', organizerEmail()),
    ]),
  ].filter((part): part is string => Boolean(part));

  return sections.join('\n\n');
}

function section(title: string, lines: Array<string | null>): string | null {
  const kept = lines.filter((line): line is string => Boolean(line));
  if (kept.length === 0) return null;
  return [title, ...kept].join('\n');
}

function field(
  label: string,
  value: string | number | null | undefined,
): string | null {
  const shown = text(value);
  if (!shown) return null;
  return `${label}: ${shown}`;
}

function text(value: string | number | null | undefined): string {
  if (value == null) return '';
  return String(value).trim();
}

function meetingAttendees(visitorEmail?: string | null) {
  const emails = [organizerEmail(), visitorEmail?.trim().toLowerCase() || '']
    .map((email) => email.trim())
    .filter(Boolean);
  return [...new Set(emails)].map((email) => ({ email }));
}

function meetLinkFromEvent(event: CalendarEventResource): string | null {
  const hangout = event.hangoutLink?.trim();
  if (hangout) return hangout;
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video' && entry.uri?.trim(),
  );
  return video?.uri?.trim() || null;
}

function requireMeetLink(event: CalendarEventResource): string {
  const link = meetLinkFromEvent(event);
  if (!link) {
    throw new ServiceUnavailableException(
      'The Google Meet link could not be created. Please try again.',
    );
  }
  return link;
}
