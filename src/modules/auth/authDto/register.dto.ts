import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsPhoneNumber,
  IsString,
} from 'class-validator';
import {
  IsStrongEnoughPassword,
  normalizeAuthEmail,
} from '../auth-password.util';

export class RegisterUserDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeAuthEmail(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @IsStrongEnoughPassword()
  password: string;

  @IsString()
  @IsPhoneNumber()
  phone: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  role: string;
}
