import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  BUSINESS_MEMBER_PERMISSIONS,
  BUSINESS_MEMBER_ROLES,
} from '../member.constants';

export class InviteMemberDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  businessId: number;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsIn(BUSINESS_MEMBER_ROLES)
  role: (typeof BUSINESS_MEMBER_ROLES)[number];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(BUSINESS_MEMBER_PERMISSIONS, { each: true })
  permissions: (typeof BUSINESS_MEMBER_PERMISSIONS)[number][];
}
