import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityEvent } from '../../db/entities/activity-event.entity';
import { BusinessHistory } from '../../db/entities/business-history.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessUserSidebarSectionReadState } from '../../db/entities/business-user-sidebar-section-read-state.entity';
import { Order } from '../../db/entities/order.entity';
import { AuthModule } from '../auth/auth.module';
import { FunnelPaymentSidebarUnreadSubscriber } from './funnel-payment-sidebar-unread.subscriber';
import { OrderSidebarUnreadSubscriber } from './order-sidebar-unread.subscriber';
import { SidebarSectionNotifyService } from './sidebar-section-notify.service';
import { SidebarUnreadController } from './sidebar-unread.controller';
import { SidebarUnreadService } from './sidebar-unread.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BusinessUserSidebarSectionReadState,
      Order,
      ActivityEvent,
      BusinessHistory,
      BusinessMember,
    ]),
    AuthModule,
  ],
  controllers: [SidebarUnreadController],
  providers: [
    SidebarUnreadService,
    SidebarSectionNotifyService,
    OrderSidebarUnreadSubscriber,
    FunnelPaymentSidebarUnreadSubscriber,
  ],
  exports: [SidebarUnreadService, SidebarSectionNotifyService],
})
export class SidebarUnreadModule {}
