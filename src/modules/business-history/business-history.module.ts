import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessHistory } from '../../db/entities/business-history.entity';
import { AuthModule } from '../auth/auth.module';
import { BusinessHistoryController } from './business-history.controller';
import { BusinessHistoryService } from './business-history.service';

@Module({
  imports: [TypeOrmModule.forFeature([BusinessHistory]), AuthModule],
  controllers: [BusinessHistoryController],
  providers: [BusinessHistoryService],
  exports: [BusinessHistoryService],
})
export class BusinessHistoryModule {}
