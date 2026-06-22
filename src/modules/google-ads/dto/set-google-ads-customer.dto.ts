import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SetGoogleAdsCustomerDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsOptional()
  @IsString()
  managerCustomerId?: string;
}
