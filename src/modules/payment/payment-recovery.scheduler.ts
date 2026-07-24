import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  PAYMENT_RECOVERY_QUEUE,
  PAYMENT_RECOVERY_SCHEDULER_KEY,
} from './payment-recovery.constants';

@Injectable()
export class PaymentRecoveryScheduler implements OnModuleInit {
  private readonly logger = new Logger(PaymentRecoveryScheduler.name);

  constructor(
    @InjectQueue(PAYMENT_RECOVERY_QUEUE)
    private readonly paymentRecoveryQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.paymentRecoveryQueue.removeJobScheduler(
        PAYMENT_RECOVERY_SCHEDULER_KEY,
      );
      this.logger.log('Payment recovery cron removed');
    } catch (err) {
      this.logger.warn(
        `Could not remove payment recovery cron: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
