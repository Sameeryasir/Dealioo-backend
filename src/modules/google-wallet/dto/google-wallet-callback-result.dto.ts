export class GoogleWalletCallbackResultDto {
  success: boolean;
  updated: boolean;
  eventType?: string | null;
  couponId?: number;
  reason?: string;
}
