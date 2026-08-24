import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from '../../db/entities/coupon.entity';
import { GoogleWalletEvent } from '../../db/entities/google-wallet-event.entity';
import { GoogleWalletController } from './google-wallet.controller';
import { GoogleWalletReconciliationSchedulerService } from './google-wallet-reconciliation.scheduler';
import { GoogleWalletService } from './google-wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([Coupon, GoogleWalletEvent])],
  controllers: [GoogleWalletController],
  providers: [GoogleWalletService, GoogleWalletReconciliationSchedulerService],
  exports: [GoogleWalletService],
})
export class GoogleWalletModule {}
