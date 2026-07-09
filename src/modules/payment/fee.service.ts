import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type PlatformFeeModel = 'fixed' | 'percentage' | 'fixed_plus_percentage';

export type CalculatePlatformFeeInput = {
  chargeAmountMinor: number;
  currency: string;
  businessId?: number;
  campaignId?: number;
};

export type CalculatePlatformFeeResult = {
  applicationFeeAmount: number;
  model: PlatformFeeModel;
};

/**
 * Backend-owned platform fee calculation.
 * Frontend must never supply fee amounts (MCP Context 7).
 */
@Injectable()
export class FeeService {
  constructor(private readonly config: ConfigService) {}

  calculatePlatformFee(
    input: CalculatePlatformFeeInput,
  ): CalculatePlatformFeeResult {
    const { chargeAmountMinor } = input;
    if (!Number.isFinite(chargeAmountMinor) || chargeAmountMinor < 1) {
      return { applicationFeeAmount: 0, model: 'fixed' };
    }

    const fixedMinor = this.parseNonNegativeInt(
      this.config.get<string>('PLATFORM_FEE_FIXED_MINOR'),
      200,
    );
    const percentBps = this.parseNonNegativeInt(
      this.config.get<string>('PLATFORM_FEE_PERCENT_BPS'),
      0,
    );

    let fee = fixedMinor;
    let model: PlatformFeeModel = 'fixed';

    if (percentBps > 0) {
      const percentFee = Math.round(
        (chargeAmountMinor * percentBps) / 10_000,
      );
      fee = Math.max(fee, percentFee);
      model = fixedMinor > 0 ? 'fixed_plus_percentage' : 'percentage';
    }

    if (fee >= chargeAmountMinor) {
      fee = Math.max(0, chargeAmountMinor - 1);
    }

    return { applicationFeeAmount: fee, model };
  }

  private parseNonNegativeInt(
    raw: string | undefined,
    fallback: number,
  ): number {
    if (raw == null || raw.trim() === '') {
      return fallback;
    }
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
}
