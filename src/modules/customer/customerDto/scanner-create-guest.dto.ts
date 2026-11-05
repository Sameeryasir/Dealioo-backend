import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ScannerCreateGuestDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;
}
