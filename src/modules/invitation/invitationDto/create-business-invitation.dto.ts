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
  INVITABLE_BUSINESS_MEMBER_ROLES,
  type InvitableBusinessMemberRole,
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
): InvitableBusinessMemberRole | null {
  const trimmed = role.trim();
  const normalized =
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  if (
    (INVITABLE_BUSINESS_MEMBER_ROLES as readonly string[]).includes(normalized)
  ) {
    return normalized as InvitableBusinessMemberRole;
  }
  return null;
}
