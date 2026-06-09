import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Min } from 'class-validator';

export class LogPrepaidForOfferDto {
  @IsInt()
  @Min(1)
  paymentId: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;
}
