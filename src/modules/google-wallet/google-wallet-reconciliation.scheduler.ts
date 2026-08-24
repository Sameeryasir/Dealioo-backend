import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GoogleWalletService } from './google-wallet.service';

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_PENDING_MIN_AGE_MS = 90_000;

@Injectable()
export class GoogleWalletReconciliationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    GoogleWalletReconciliationSchedulerService.name,
  );
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly googleWalletService: GoogleWalletService) {}

  onModuleInit(): void {
    const intervalMs = DEFAULT_POLL_MS;
    this.timer = setInterval(() => {
      void this.googleWalletService
        .reconcileStalePendingCoupons()
        .then((count) => {
          if (count > 0) {
            this.logger.log(
              `Google Wallet fallback reconciled ${count} pending coupon(s)`,
            );
          }
        })
        .catch((err) => {
          this.logger.error(
            `Google Wallet pending reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }, intervalMs);
    this.logger.log(
      `Google Wallet pending reconciliation polling every ${intervalMs}ms (min age ${DEFAULT_PENDING_MIN_AGE_MS}ms)`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
