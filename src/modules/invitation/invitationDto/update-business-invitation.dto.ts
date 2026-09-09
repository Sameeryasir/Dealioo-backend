import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BUSINESS_MEMBER_PERMISSIONS } from '../../member/member.constants';

export class UpdateBusinessInvitationDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  role?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(BUSINESS_MEMBER_PERMISSIONS, { each: true })
  permissions?: (typeof BUSINESS_MEMBER_PERMISSIONS)[number][];
}
