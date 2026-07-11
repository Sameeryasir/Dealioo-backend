import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptMemberInviteDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token: string;
}
