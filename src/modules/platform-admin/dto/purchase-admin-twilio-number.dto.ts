import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class PurchaseAdminTwilioNumberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^\+?[0-9]{8,15}$/, {
    message: 'phoneNumber must be a valid E.164-style number.',
  })
  phoneNumber!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  businessId?: number;
}
