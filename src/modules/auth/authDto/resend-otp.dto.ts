import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normalizeAuthEmail } from '../auth-password.util';

export class ResendOtpDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeAuthEmail(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
