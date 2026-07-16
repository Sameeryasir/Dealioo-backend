import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  BUSINESS_MEMBER_PERMISSIONS,
  BUSINESS_MEMBER_ROLES,
  type BusinessMemberRole,
} from '../../member/member.constants';

export class CreateBusinessInvitationDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(32)
  role!: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(BUSINESS_MEMBER_PERMISSIONS, { each: true })
  permissions!: (typeof BUSINESS_MEMBER_PERMISSIONS)[number][];
}

export function normalizeInvitationRole(
  role: string,
): BusinessMemberRole | null {
  const trimmed = role.trim();
  const normalized =
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  if (
    (BUSINESS_MEMBER_ROLES as readonly string[]).includes(normalized)
  ) {
    return normalized as BusinessMemberRole;
  }
  return null;
}
