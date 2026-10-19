import { ServiceUnavailableException } from '@nestjs/common';
import { MeetingRequestService } from './meeting-request.service';
import type { CreateMeetingRequestDto } from './meetingRequestDto/create-meeting-request.dto';

describe('MeetingRequestService calendar booking', () => {
  const dto = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '5551234567',
    email: 'ada@example.com',
    businessCategory: 'Agency',
    businessName: 'Analytical Engines',
    cityLocation: 'Austin',
    scheduledDate: '2026-11-02',
    scheduledTime: '10:00',
    scheduledDuration: 30,
    scheduledTimeZone: 'America/Chicago',
  } as CreateMeetingRequestDto;

  function makeService(calendar: {
    createMeetingEvent: jest.Mock;
    deleteEvent: jest.Mock;
  }) {
    const saved = { id: 9, email: 'ada@example.com' };
    const repo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, ...saved })),
    };
    const users = { findOne: jest.fn(async () => null) };
    const notifications = { notifyMeetingRequested: jest.fn(async () => undefined) };
    const service = new MeetingRequestService(
      repo as never,
      users as never,
      notifications as never,
      calendar as never,
    );
    return { service, repo };
  }

  it('does not save the meeting when Google Calendar fails', async () => {
    const calendar = {
      createMeetingEvent: jest
        .fn()
        .mockRejectedValue(
          new ServiceUnavailableException(
            'This meeting could not be added to the calendar. Please try again.',
          ),
        ),
      deleteEvent: jest.fn(),
    };
    const { service, repo } = makeService(calendar);

    await expect(service.create(dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('saves the meeting when the calendar is not connected yet', async () => {
    const calendar = {
      createMeetingEvent: jest.fn().mockResolvedValue(null),
      deleteEvent: jest.fn(),
    };
    const { service, repo } = makeService(calendar);

    const saved = await service.create(dto);

    expect(saved.id).toBe(9);
    expect(repo.save).toHaveBeenCalled();
  });

  it('saves the calendar event id after Google creates the event', async () => {
    const calendar = {
      createMeetingEvent: jest.fn().mockResolvedValue({
        eventId: 'event-1',
        htmlLink: 'https://calendar.google.com/event?eid=event-1',
        meetLink: 'https://meet.google.com/abc-defg-hij',
        created: true,
      }),
      deleteEvent: jest.fn(),
    };
    const { service, repo } = makeService(calendar);

    const saved = await service.create(dto);

    expect(saved.googleEventId).toBe('event-1');
    expect(saved.googleMeetLink).toBe('https://meet.google.com/abc-defg-hij');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ googleEventId: 'event-1' }),
    );
  });
});
