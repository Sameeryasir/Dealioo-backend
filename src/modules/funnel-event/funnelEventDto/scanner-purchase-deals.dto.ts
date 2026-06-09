import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  Min,
} from 'class-validator';

export class ScannerPurchaseDealsDto {
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  funnelIds: number[];

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  orderSubtotal: number;
}
