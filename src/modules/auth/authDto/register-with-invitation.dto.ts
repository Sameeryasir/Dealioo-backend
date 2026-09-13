import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsStrongEnoughPassword } from '../auth-password.util';

export class RegisterWithInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  @MaxLength(128)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @IsStrongEnoughPassword()
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}
