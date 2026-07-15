import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../../db/entities/business.entity';
import { User } from '../../db/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { BusinessController } from './business.controller';
import { BusinessService } from './business.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Business, User]),
    AuthModule,
  ],
  controllers: [BusinessController],
  providers: [BusinessService],
  exports: [BusinessService],
})
export class BusinessModule {}
