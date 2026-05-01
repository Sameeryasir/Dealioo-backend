import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Role } from '../../db/entities/role.entity';
import { User } from '../../db/entities/user.entity';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role]), AuthModule],
  providers: [UserService],
  controllers: [UserController],
})
export class UserModule {}
