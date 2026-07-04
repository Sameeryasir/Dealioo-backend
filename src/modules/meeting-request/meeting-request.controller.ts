import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { CreateMeetingRequestDto } from './meetingRequestDto/create-meeting-request.dto';
import { MeetingRequestService } from './meeting-request.service';

@Controller('meeting-requests')
export class MeetingRequestController {
  constructor(private readonly meetingRequestService: MeetingRequestService) {}
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateMeetingRequestDto): Promise<MeetingRequest> {
    return this.meetingRequestService.create(dto);
  }
}
