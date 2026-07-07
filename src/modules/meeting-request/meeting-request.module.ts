import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { MeetingRequestController } from './meeting-request.controller';
import { MeetingRequestService } from './meeting-request.service';

@Module({
  imports: [TypeOrmModule.forFeature([MeetingRequest])],
  controllers: [MeetingRequestController],
  providers: [MeetingRequestService],
})
export class MeetingRequestModule {}
