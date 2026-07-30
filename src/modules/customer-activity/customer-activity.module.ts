import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerActivity } from '../../db/entities/customer-activity.entity';
import { CustomerActivityService } from './customer-activity.service';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerActivity])],
  providers: [CustomerActivityService],
  exports: [CustomerActivityService],
})
export class CustomerActivityModule {}
