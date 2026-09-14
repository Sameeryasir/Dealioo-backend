import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessHistory } from '../../db/entities/business-history.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { AuthModule } from '../auth/auth.module';
import { SidebarUnreadModule } from '../sidebar-unread/sidebar-unread.module';
import { BusinessHistoryController } from './business-history.controller';
import { BusinessHistoryService } from './business-history.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessHistory, BusinessMember, Business]),
    AuthModule,
    SidebarUnreadModule,
  ],
  controllers: [BusinessHistoryController],
  providers: [BusinessHistoryService],
  exports: [BusinessHistoryService],
})
export class BusinessHistoryModule {}
