import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { User } from '../../db/entities/user.entity';
import { AdminNotificationWriter } from '../admin-notifications/admin-notifications.writer';
import { CreateMeetingRequestDto } from './meetingRequestDto/create-meeting-request.dto';

@Injectable()
export class MeetingRequestService {
  constructor(
    @InjectRepository(MeetingRequest)
    private readonly meetingRequestRepo: Repository<MeetingRequest>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly adminNotificationWriter: AdminNotificationWriter,
  ) {}

  async create(dto: CreateMeetingRequestDto): Promise<MeetingRequest> {
    const record = this.meetingRequestRepo.create({
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      phone: dto.phone.trim(),
      email: dto.email.trim().toLowerCase(),
      businessRole: dto.businessRole,
      businessCategory: dto.businessCategory.trim(),
      businessName: dto.businessName.trim(),
      cityLocation: dto.cityLocation.trim(),
      monthlyRevenue: dto.monthlyRevenue,
      marketingActivities: dto.marketingActivities,
      currentSituation: dto.currentSituation.trim(),
      startTimeline: dto.startTimeline,
      meetingCommitment: dto.meetingCommitment,
    });

    const saved = await this.meetingRequestRepo.save(record);

    // Super Admin live alert: "Jane Doe requested a meeting for Acme."
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
      actorUserId: actor?.id ?? null,
    });

    return saved;
  }
}
