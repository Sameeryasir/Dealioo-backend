import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { normalizeAuthEmail } from '../auth-password.util';

export class LoginUserDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeAuthEmail(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
