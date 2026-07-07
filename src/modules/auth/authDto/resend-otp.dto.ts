import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ResendOtpDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
