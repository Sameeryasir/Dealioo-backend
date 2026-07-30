import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * How staff recorded the deal purchase at the scanner.
 * IN_PERSON = paid/collected at the counter
 * REDEEMED = deal was redeemed (pass used) rather than a fresh counter sale
 * SCANNED = deal was recorded via QR / code scan
 */
export enum ScannerPurchaseMeans {
  IN_PERSON = 'IN_PERSON',
  REDEEMED = 'REDEEMED',
  SCANNED = 'SCANNED',
}

export class ScannerPurchaseDealsDto {
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  funnelIds: number[];

  // --- Purchase means (required) ---
  // Caller must say whether this attach-deals action was in-person, redeemed, or scanned.
  @IsEnum(ScannerPurchaseMeans)
  purchaseMeans: ScannerPurchaseMeans;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  orderSubtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  extraItemsAmount?: number;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}
