import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomInt } from 'crypto';
import { render } from '@react-email/render';
import * as React from 'react';
import { QueryFailedError, Repository } from 'typeorm';
import { MeetingEmailChallenge } from '../../db/entities/meeting-email-challenge.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { User } from '../../db/entities/user.entity';
import { OtpEmail } from '../../templates/otp-email';
import { AdminNotificationWriter } from '../admin-notifications/admin-notifications.writer';
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { CreateMeetingRequestDto } from './meetingRequestDto/create-meeting-request.dto';
import {
  ConfirmMeetingEmailOtpDto,
  SendMeetingEmailOtpDto,
} from './meetingRequestDto/verify-meeting-email.dto';

function isTakenSlot(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const code = (error as QueryFailedError & { driverError?: { code?: string } })
    .driverError?.code;
  return code === '23505';
}

@Injectable()
export class MeetingRequestService {
  constructor(
    @InjectRepository(MeetingRequest)
    private readonly meetingRequestRepo: Repository<MeetingRequest>,
    @InjectRepository(MeetingEmailChallenge)
    private readonly emailChallengeRepo: Repository<MeetingEmailChallenge>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly adminNotificationWriter: AdminNotificationWriter,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly mailDelivery: MailDeliveryService,
  ) {}

  async sendEmailOtp(
    dto: SendMeetingEmailOtpDto,
  ): Promise<{ message: string }> {
    const email = dto.email.trim().toLowerCase();
    const code = String(randomInt(100_000, 1_000_000));
    const expiresInMinutes = 10;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await this.emailChallengeRepo.save(
      this.emailChallengeRepo.create({
        email,
        code,
        expiresAt,
        isUsed: false,
        proofTokenHash: null,
        proofExpiresAt: null,
        proofUsedAt: null,
      }),
    );

    const html = await render(
      React.createElement(OtpEmail, {
        name: email.split('@')[0] || 'there',
        email,
        code,
        expiresInMinutes,
      }),
    );
    await this.mailDelivery.sendHtmlEmail({
      to: email,
      subject: process.env.MAIL_OTP_SUBJECT ?? 'Your verification code',
      html,
      text: `Your Dealioo verification code is ${code}. It expires in ${expiresInMinutes} minutes.`,
      tags: ['meeting', 'email-otp'],
    });

    return { message: 'Verification code sent.' };
  }

  async confirmEmailOtp(
    dto: ConfirmMeetingEmailOtpDto,
  ): Promise<{ message: string; emailVerificationToken: string }> {
    const email = dto.email.trim().toLowerCase();
    const code = String(dto.otp);
    const challenge = await this.emailChallengeRepo.findOne({
      where: { email, isUsed: false },
      order: { createdAt: 'DESC' },
    });

    if (
      !challenge ||
      challenge.code !== code ||
      challenge.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Invalid or expired verification code.');
    }

    const proofToken = randomBytes(32).toString('base64url');
    challenge.isUsed = true;
    challenge.proofTokenHash = this.hashToken(proofToken);
    challenge.proofExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    challenge.proofUsedAt = null;
    await this.emailChallengeRepo.save(challenge);

    return {
      message: 'Email verified.',
      emailVerificationToken: proofToken,
    };
  }

  async create(dto: CreateMeetingRequestDto): Promise<MeetingRequest> {
    this.assertOpenSlot(dto);
    const email = dto.email.trim().toLowerCase();
    await this.consumeEmailProof(email, dto.emailVerificationToken);
    const draft = this.meetingRequestRepo.create({
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      phone: dto.phone.trim(),
      email,
      businessRole: dto.businessRole || '',
      businessCategory: dto.businessCategory.trim(),
      businessName: dto.businessName.trim(),
      cityLocation: dto.cityLocation.trim(),
      businessPhone: dto.businessPhone?.trim() || null,
      currency: dto.currency?.trim() || null,
      businessEmail: dto.businessEmail?.trim().toLowerCase() || null,
      description: dto.description?.trim() || null,
      website: dto.website?.trim() || null,
      state: dto.state?.trim() || null,
      postalCode: dto.postalCode?.trim() || null,
      country: dto.country?.trim() || null,
      monthlyRevenue: dto.monthlyRevenue || '',
      marketingActivities: dto.marketingActivities ?? [],
      currentSituation: dto.currentSituation?.trim() || '',
      startTimeline: dto.startTimeline || '',
      meetingCommitment: dto.meetingCommitment || '',
      selectedPlanSlug: (dto.selectedPlanSlug ?? '').trim().toLowerCase() || null,
      selectedPlanName: (dto.selectedPlanName ?? '').trim() || null,
      selectedBillingCycle:
        dto.selectedBillingCycle === 'monthly' ||
        dto.selectedBillingCycle === 'annual'
          ? dto.selectedBillingCycle
          : null,
      scheduledDate: dto.scheduledDate || null,
      scheduledTime: dto.scheduledTime || null,
      scheduledDuration: dto.scheduledDuration ?? null,
      scheduledTimeZone: dto.scheduledTimeZone?.trim() || null,
    });

    let saved: MeetingRequest;
    try {
      saved = await this.meetingRequestRepo.save(draft);
    } catch (error) {
      if (isTakenSlot(error)) {
        throw new ConflictException(
          'That time was just taken. Please pick another time.',
        );
      }
      throw error;
    }

    let event: Awaited<
      ReturnType<GoogleCalendarService['createMeetingEvent']>
    > = null;
    try {
      event = await this.googleCalendarService.createMeetingEvent(saved);
      if (event) {
        saved.googleEventId = event.eventId;
        saved.googleEventLink = event.htmlLink;
        saved.googleMeetLink = event.meetLink;
        saved = await this.meetingRequestRepo.save(saved);
      }
    } catch (error) {
      if (event?.created) {
        await this.googleCalendarService.deleteEvent(event.eventId);
      }
      await this.meetingRequestRepo.delete(saved.id);
      if (isTakenSlot(error)) {
        throw new ConflictException(
          'That time was just taken. Please pick another time.',
        );
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'This meeting could not be saved. Please try again.',
      );
    }

    const actor = await this.userRepository.findOne({
      where: { email: saved.email },
      select: { id: true },
    });
    await this.adminNotificationWriter.notifyMeetingRequested({
      meetingRequestId: saved.id,
      firstName: saved.firstName,
      lastName: saved.lastName,
      email: saved.email,
      businessName: saved.businessName,
      selectedPlanName: saved.selectedPlanName,
      selectedPlanSlug: saved.selectedPlanSlug,
      actorUserId: actor?.id ?? null,
    });

    return saved;
  }

  private async consumeEmailProof(
    email: string,
    rawToken: string,
  ): Promise<void> {
    const token = rawToken?.trim() ?? '';
    if (token.length < 16) {
      throw new UnauthorizedException(
        'Please verify your email before booking.',
      );
    }

    const challenge = await this.emailChallengeRepo.findOne({
      where: { proofTokenHash: this.hashToken(token) },
    });

    if (
      !challenge ||
      challenge.email !== email ||
      challenge.proofUsedAt != null ||
      !challenge.proofExpiresAt ||
      challenge.proofExpiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException(
        'Please verify your email before booking.',
      );
    }

    challenge.proofUsedAt = new Date();
    await this.emailChallengeRepo.save(challenge);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private assertOpenSlot(dto: CreateMeetingRequestDto): void {
    const date = dto.scheduledDate?.trim() ?? '';
    const time = dto.scheduledTime?.trim() ?? '';
    const zone = dto.scheduledTimeZone?.trim() ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      throw new BadRequestException('Pick an open meeting day and time.');
    }
    if (![15, 30].includes(dto.scheduledDuration ?? 0)) {
      throw new BadRequestException('Choose a 15 or 30 minute meeting.');
    }
    if (!zone || zone.length > 64) {
      throw new BadRequestException('A time zone is required for the meeting.');
    }
    try {
      Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    } catch {
      throw new BadRequestException('That time zone is not recognized.');
    }

    const slots = [
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ];
    if (!slots.includes(time)) {
      throw new BadRequestException('Pick one of the open meeting times.');
    }

    const [year, month, day] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday === 0 || weekday === 6) {
      throw new BadRequestException('Meetings are available on weekdays.');
    }

    const today = this.calendarDate(new Date(), zone);
    const last = this.addCalendarDays(today, 60);
    if (date < today || date > last) {
      throw new BadRequestException('Pick a weekday within the next 60 days.');
    }
    if (date === today) {
      const nowMinutes = this.minutesInZone(new Date(), zone);
      const [hour, minute] = time.split(':').map(Number);
      if (hour * 60 + minute < nowMinutes) {
        throw new BadRequestException('That time has already passed.');
      }
    }
  }

  private calendarDate(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
    const month = parts.find((part) => part.type === 'month')?.value ?? '00';
    const day = parts.find((part) => part.type === 'day')?.value ?? '00';
    return `${year}-${month}-${day}`;
  }

  private addCalendarDays(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1, day));
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  }

  private minutesInZone(date: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(
      parts.find((part) => part.type === 'hour')?.value ?? '0',
    );
    const minute = Number(
      parts.find((part) => part.type === 'minute')?.value ?? '0',
    );
    return hour * 60 + minute;
  }
}
