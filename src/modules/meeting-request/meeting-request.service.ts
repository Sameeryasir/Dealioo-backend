import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { CreateMeetingRequestDto } from './meetingRequestDto/create-meeting-request.dto';

@Injectable()
export class MeetingRequestService {
  constructor(
    @InjectRepository(MeetingRequest)
    private readonly meetingRequestRepo: Repository<MeetingRequest>,
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

    return this.meetingRequestRepo.save(record);
  }
}
