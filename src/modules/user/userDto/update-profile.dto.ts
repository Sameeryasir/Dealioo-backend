import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Fields a signed-in user may update on their own account. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
