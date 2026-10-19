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

const ROLE_LABELS: Record<string, string> = {
  business_owner: 'Business owner',
  in_house_marketer: 'In-house marketer',
  marketing_agency: 'Marketing agency',
  consultant_partner: 'Consultant or partner',
};

const REVENUE_LABELS: Record<string, string> = {
  under_50k: 'Under $50,000',
  '50k_100k': '$50,000 to $100,000',
  '100k_250k': '$100,000 to $250,000',
  '250k_plus': 'Over $250,000',
  '1m_plus': 'Over $1 million',
  '10m_plus': 'Over $10 million',
};

const ACTIVITY_LABELS: Record<string, string> = {
  paid_ads: 'Paid ads on Meta, Google, or TikTok',
  organic_social: 'Organic social content',
  influencer: 'Influencer marketing',
  sms_email: 'SMS or email marketing',
  loyalty_program: 'Loyalty program',
  other: 'Other',
};

const TIMELINE_LABELS: Record<string, string> = {
  immediately: 'Start right away',
  one_to_three_months: 'Start in 1 to 3 months',
  just_exploring: 'Just exploring',
};

const COMMITMENT_LABELS: Record<string, string> = {
  yes: 'Yes, I will come prepared',
  not_sure: 'No, I am not sure yet',
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
  const fullName = `${meeting.firstName} ${meeting.lastName}`.trim();
  const activities = (meeting.marketingActivities ?? [])
    .map((item) => labeled(ACTIVITY_LABELS, item))
    .filter(Boolean)
    .join(', ');
  const revenue = labeled(REVENUE_LABELS, meeting.monthlyRevenue);
  const revenueLine = [revenue, text(meeting.currency)]
    .filter(Boolean)
    .join(' ');

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
    section('Visitor information', [
      field('First name', meeting.firstName),
      field('Last name', meeting.lastName),
      field('Full name', fullName),
      field('Email', meeting.email),
    ]),
    section('Business information', [
      field('Business name', meeting.businessName),
      field('Business category', meeting.businessCategory),
      field('Business phone', meeting.businessPhone),
      field('Business email', meeting.businessEmail),
      field('Website', meeting.website),
      field('City', meeting.cityLocation),
      field('State', meeting.state),
      field('Country', meeting.country),
      field('Postal code', meeting.postalCode),
    ]),
    section('Consultation context', [
      field('Business role', labeled(ROLE_LABELS, meeting.businessRole)),
      field('Monthly revenue', revenueLine),
      field('Current marketing', activities),
      field('Current situation', meeting.currentSituation),
      field('Start timeline', labeled(TIMELINE_LABELS, meeting.startTimeline)),
      field(
        'Meeting commitment',
        labeled(COMMITMENT_LABELS, meeting.meetingCommitment),
      ),
      field('Notes', meeting.description),
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

function labeled(
  labels: Record<string, string>,
  value: string | null | undefined,
): string {
  const raw = text(value);
  if (!raw) return '';
  return labels[raw] ?? raw;
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
