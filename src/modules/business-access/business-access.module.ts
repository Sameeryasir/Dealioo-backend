import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import { BusinessAccessService } from './business-access.service';
import { BusinessMembershipCacheService } from './business-membership-cache.service';
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
  providers: [
    BusinessAccessService,
    BusinessMembershipCacheService,
    BusinessPermissionGuard,
  ],
  exports: [
    BusinessAccessService,
    BusinessMembershipCacheService,
    BusinessPermissionGuard,
  ],
})
export class BusinessAccessModule {}
