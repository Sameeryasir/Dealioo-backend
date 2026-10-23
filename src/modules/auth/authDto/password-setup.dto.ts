import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { IsStrongEnoughPassword } from '../auth-password.util';

export class PasswordSetupTokenDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  token: string;
}

export class PasswordSetupCompleteDto extends PasswordSetupTokenDto {
  @IsString()
  @IsNotEmpty()
  @IsStrongEnoughPassword()
  password: string;
}
