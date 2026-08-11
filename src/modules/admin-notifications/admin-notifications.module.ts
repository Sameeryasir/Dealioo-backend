import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotification } from '../../db/entities/admin-notification.entity';
import { AdminNotificationWriter } from './admin-notifications.writer';

@Module({
  imports: [TypeOrmModule.forFeature([AdminNotification])],
  providers: [AdminNotificationWriter],
  exports: [AdminNotificationWriter],
})
export class AdminNotificationsModule {}
