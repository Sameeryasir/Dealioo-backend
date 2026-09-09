import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { BusinessInvitation } from '../../db/entities/business-invitation.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import { Role } from '../../db/entities/role.entity';
import { AuthModule } from '../auth/auth.module';
import { BusinessAccessModule } from '../business-access/business-access.module';
import { MemberController } from './member.controller';
import { MemberService } from './member.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Business,
      BusinessInvitation,
      BusinessMember,
      BusinessMemberPermission,
      Role,
    ]),
    AuthModule,
    BusinessAccessModule,
  ],
  controllers: [MemberController],
  providers: [MemberService],
  exports: [MemberService],
})
export class MemberModule {}
