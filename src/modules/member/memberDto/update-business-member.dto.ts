import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  BUSINESS_MEMBER_PERMISSIONS,
  BUSINESS_MEMBER_ROLES,
} from '../member.constants';

export class UpdateBusinessMemberDto {
  @IsString()
  @MaxLength(32)
  @IsIn([...BUSINESS_MEMBER_ROLES])
  role!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(BUSINESS_MEMBER_PERMISSIONS, { each: true })
  permissions!: (typeof BUSINESS_MEMBER_PERMISSIONS)[number][];
}
