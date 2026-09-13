import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { normalizeAuthEmail } from '../auth-password.util';

export class VerifyOtpDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeAuthEmail(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNumber()
  @IsNotEmpty()
  otp: number;
}
