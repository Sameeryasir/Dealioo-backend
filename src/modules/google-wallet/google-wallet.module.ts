import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from '../../db/entities/coupon.entity';
import { GoogleWalletController } from './google-wallet.controller';
import { GoogleWalletService } from './google-wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon])],
  controllers: [GoogleWalletController],
  providers: [GoogleWalletService],
  exports: [GoogleWalletService],
})
export class GoogleWalletModule {}
