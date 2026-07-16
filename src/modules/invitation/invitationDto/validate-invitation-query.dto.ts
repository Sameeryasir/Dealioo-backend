import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ValidateInvitationQueryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  @MaxLength(128)
  token!: string;
}
