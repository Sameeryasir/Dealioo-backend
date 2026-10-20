import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsStrongEnoughPassword } from '../../auth/auth-password.util';

export class CreateAdminUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @IsStrongEnoughPassword()
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  roleName: string;

  @IsOptional()
  @IsBoolean()
  confirmElevateToSuperAdmin?: boolean;
}
