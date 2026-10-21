import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { CreateMeetingRequestDto } from './meetingRequestDto/create-meeting-request.dto';
import {
  ConfirmMeetingEmailOtpDto,
  SendMeetingEmailOtpDto,
} from './meetingRequestDto/verify-meeting-email.dto';
import { MeetingRequestService } from './meeting-request.service';

@Controller('meeting-requests')
export class MeetingRequestController {
  constructor(private readonly meetingRequestService: MeetingRequestService) {}

  @Post('verify-email/send')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  sendEmailOtp(@Body() dto: SendMeetingEmailOtpDto) {
    return this.meetingRequestService.sendEmailOtp(dto);
  }

  @Post('verify-email/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirmEmailOtp(@Body() dto: ConfirmMeetingEmailOtpDto) {
    return this.meetingRequestService.confirmEmailOtp(dto);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@Body() dto: CreateMeetingRequestDto): Promise<MeetingRequest> {
    return this.meetingRequestService.create(dto);
  }
}
