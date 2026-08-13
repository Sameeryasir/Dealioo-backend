import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';

export const SELECTABLE_META_OAUTH_SCOPES = [
  'ads_read',
  'ads_management',
] as const;

export type SelectableMetaOAuthScope =
  (typeof SELECTABLE_META_OAUTH_SCOPES)[number];

export class ConnectFacebookDto {
  @IsArray()
  @ArrayMinSize(1, {
    message: 'Select at least one Meta Ads permission before connecting.',
  })
  @IsString({ each: true })
  @IsIn([...SELECTABLE_META_OAUTH_SCOPES], {
    each: true,
    message: `Each permission must be one of: ${SELECTABLE_META_OAUTH_SCOPES.join(', ')}`,
  })
  scopes: string[];
}
