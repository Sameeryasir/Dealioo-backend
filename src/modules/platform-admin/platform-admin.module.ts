import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotification } from '../../db/entities/admin-notification.entity';
import { Business } from '../../db/entities/business.entity';
import { MeetingRequest } from '../../db/entities/meeting-request.entity';
import { Order } from '../../db/entities/order.entity';
import { User } from '../../db/entities/user.entity';
import { UserSubscription } from '../../db/entities/user-subscription.entity';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Business,
      Order,
      UserSubscription,
      AdminNotification,
      MeetingRequest,
    ]),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
