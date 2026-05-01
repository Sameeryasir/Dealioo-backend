import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class OtpDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
