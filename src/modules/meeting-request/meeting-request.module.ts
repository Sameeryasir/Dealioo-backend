import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { User } from '../../db/entities/user.entity';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { MeetingRequestController } from './meeting-request.controller';
import { MeetingRequestService } from './meeting-request.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MeetingRequest, User]),
    AdminNotificationsModule,
  ],
  controllers: [MeetingRequestController],
  providers: [MeetingRequestService],
})
export class MeetingRequestModule {}
