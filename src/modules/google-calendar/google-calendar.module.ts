import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleCalendarConnection } from '../../db/entities/google-calendar-connection.entity';
import { AuthModule } from '../auth/auth.module';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([GoogleCalendarConnection])],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
