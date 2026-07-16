import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import { BusinessAccessService } from './business-access.service';
import { BusinessPermissionGuard } from './business-permission.guard';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Business,
      BusinessMember,
      BusinessMemberPermission,
    ]),
  ],
  providers: [BusinessAccessService, BusinessPermissionGuard],
  exports: [BusinessAccessService, BusinessPermissionGuard],
})
export class BusinessAccessModule {}
