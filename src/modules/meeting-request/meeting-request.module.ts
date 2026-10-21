import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingEmailChallenge } from '../../db/entities/meeting-email-challenge.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { User } from '../../db/entities/user.entity';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';
import { MeetingRequestController } from './meeting-request.controller';
import { MeetingRequestService } from './meeting-request.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MeetingRequest, MeetingEmailChallenge, User]),
    AdminNotificationsModule,
    GoogleCalendarModule,
  ],
  controllers: [MeetingRequestController],
  providers: [MeetingRequestService],
})
export class MeetingRequestModule {}
