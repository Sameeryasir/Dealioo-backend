import { IsNotEmpty, IsString } from 'class-validator';

export class SetGoogleAdsCustomerDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;
}
