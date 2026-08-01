import { IsIn, IsInt, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';
import type { GoogleCampaignGoalId } from '../../../db/entities/google-campaign-builder-draft.types';

export const GOOGLE_CAMPAIGN_GOALS = [
  'SALES',
  'LEADS',
  'WEBSITE_TRAFFIC',
  'AWARENESS',
  'APP_PROMOTION',
] as const satisfies readonly GoogleCampaignGoalId[];

export class SaveGoogleGoalStepDto {
  @IsOptional()
  @IsUUID()
  draftId?: string;

  @ValidateIf((dto: SaveGoogleGoalStepDto) => Boolean(dto.draftId?.trim()))
  @IsInt()
  @Min(1)
  expectedVersion?: number;

  @IsIn(GOOGLE_CAMPAIGN_GOALS)
  goal: GoogleCampaignGoalId;
}
