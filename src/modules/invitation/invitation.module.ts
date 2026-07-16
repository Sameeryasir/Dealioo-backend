import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessInvitation } from '../../db/entities/business-invitation.entity';
import { Business } from '../../db/entities/business.entity';
import { BusinessMember } from '../../db/entities/business-member.entity';
import { BusinessMemberPermission } from '../../db/entities/business-member-permission.entity';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BusinessInvitation,
      Business,
      BusinessMember,
      BusinessMemberPermission,
      Role,
      User,
    ]),
  ],
  controllers: [InvitationController],
  providers: [InvitationService],
  exports: [InvitationService, TypeOrmModule],
})
export class InvitationModule {}
