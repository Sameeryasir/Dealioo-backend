import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  GoogleAgeRangeId,
  GoogleCallToActionId,
  GoogleGenderId,
  GoogleKeywordMatchType,
  GooglePresenceOptionId,
  GoogleRadiusUnitId,
} from '../../../db/entities/google-campaign-builder-draft.types';

export class GoogleLocationRefDto {
  @IsIn(['country', 'state', 'city', 'postal_code'])
  type: 'country' | 'state' | 'city' | 'postal_code';

  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}

export class GoogleSuggestedKeywordDto {
  @IsString()
  id: string;

  @IsString()
  text: string;

  @IsBoolean()
  enabled: boolean;
}

export class GoogleAdCreativeDto {
  @IsString()
  id: string;

  @IsString()
  finalUrl: string;

  @IsArray()
  @IsString({ each: true })
  headlines: string[];

  @IsArray()
  @IsString({ each: true })
  descriptions: string[];

  @IsOptional()
  @IsString()
  path1?: string;

  @IsOptional()
  @IsString()
  path2?: string;

  @IsIn([
    'LEARN_MORE',
    'BOOK_NOW',
    'CALL_NOW',
    'SHOP_NOW',
    'ORDER_ONLINE',
    'GET_QUOTE',
    'SIGN_UP',
    'CONTACT_US',
  ])
  callToAction: GoogleCallToActionId;
}

export class GoogleSitelinkDto {
  @IsString()
  id: string;

  @IsString()
  text: string;

  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  description1?: string;

  @IsOptional()
  @IsString()
  description2?: string;

  @IsBoolean()
  enabled: boolean;
}

export class SaveGoogleBudgetStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  dailyBudget: number;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class SaveGoogleLocationsStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoogleLocationRefDto)
  targetLocations: GoogleLocationRefDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoogleLocationRefDto)
  excludedLocationTargets?: GoogleLocationRefDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  countries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedLocations?: string[];

  @IsOptional()
  @IsBoolean()
  radiusEnabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => GoogleLocationRefDto)
  radiusCenter?: GoogleLocationRefDto | null;

  @IsOptional()
  @IsNumber()
  radiusLat?: number | null;

  @IsOptional()
  @IsNumber()
  radiusLng?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  radiusValue?: number;

  @IsOptional()
  @IsIn(['KILOMETERS', 'MILES'])
  radiusUnit?: GoogleRadiusUnitId;

  @IsOptional()
  @IsString()
  radiusTargeting?: string;

  @IsOptional()
  @IsIn([
    'PRESENCE',
    'SEARCH',
    'PRESENCE_OR_INTEREST',
    'PRESENCE_NOT_EXCLUDED',
  ])
  presenceOption?: GooglePresenceOptionId;
}

export class SaveGoogleLanguagesStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  languages: string[];
}

export class SaveGoogleAudienceStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['18-24', '25-34', '35-44', '45-54', '55+'], { each: true })
  ageRanges: GoogleAgeRangeId[];

  @IsOptional()
  @IsIn(['ALL', 'MALE', 'FEMALE'])
  gender?: GoogleGenderId;

  @IsOptional()
  @IsString()
  householdIncome?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];
}

export class SaveGoogleKeywordsStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsString()
  businessType: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoogleSuggestedKeywordDto)
  suggestedKeywords?: GoogleSuggestedKeywordDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customKeywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  negativeKeywords?: string[];

  @IsOptional()
  @IsIn(['BROAD', 'PHRASE', 'EXACT'])
  keywordMatchType?: GoogleKeywordMatchType;
}

export class SaveGoogleAdsStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoogleAdCreativeDto)
  ads: GoogleAdCreativeDto[];

  @IsOptional()
  @IsBoolean()
  adsGenerated?: boolean;
}

export class SaveGoogleExtrasStepDto {
  @IsUUID()
  draftId: string;

  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsOptional()
  @IsString()
  extensionBusinessName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  callouts?: string[];

  @IsOptional()
  @IsString()
  structuredSnippetHeader?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  structuredSnippetValues?: string[];

  @IsOptional()
  @IsBoolean()
  useLocationExtension?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoogleSitelinkDto)
  sitelinks?: GoogleSitelinkDto[];

  @IsOptional()
  @IsBoolean()
  assetsGenerated?: boolean;
}

export type GoogleCampaignStepSaveResponseDto = {
  id: string;
  businessId: number;
  currentStep: number;
  completedSteps: number[];
  version: number;
  lastSavedAt: Date | null;
};
