import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Location } from '../../db/entities/location.entity';
import { Business } from '../../db/entities/business.entity';
import { AuthModule } from '../auth/auth.module';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';

@Module({
  imports: [TypeOrmModule.forFeature([Location, Business]), AuthModule],
  controllers: [LocationController],
  providers: [LocationService],
})
export class LocationModule {}
