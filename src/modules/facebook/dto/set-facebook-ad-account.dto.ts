import { IsNotEmpty, IsString } from 'class-validator';

export class SetFacebookAdAccountDto {
  @IsString()
  @IsNotEmpty()
  adAccountId: string;
}
