import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class SaveGoogleCampaignInfoStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  campaignName: string;

  @IsString()
  businessName: string;

  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @IsOptional()
  @IsString()
  businessCategory?: string;

  @IsOptional()
  @IsString()
  logoFileName?: string;

  @IsOptional()
  @IsString()
  logoPreviewUrl?: string;

  @IsOptional()
  @IsString()
  extensionBusinessName?: string;
}
