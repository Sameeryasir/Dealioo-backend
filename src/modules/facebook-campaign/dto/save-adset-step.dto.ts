import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MetaAdSetBudgetType,
  MetaBidStrategy,
  MetaBillingEvent,
  MetaCampaignStatus,
  MetaDestinationType,
  MetaDistanceUnit,
  MetaGender,
  MetaOptimizationGoal,
} from '../meta-campaign.constants';

export class AdSetPromotedObjectDto {
  @IsOptional()
  @IsString()
  pixelId?: string;

  @IsOptional()
  @IsString()
  customEventType?: string;

  @IsOptional()
  @IsString()
  pageId?: string;
}

export class AdSetAudienceDto {
  @IsString()
  @IsNotEmpty()
  country: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @ValidateIf((dto: AdSetAudienceDto) => Boolean(dto.city?.trim()))
  @IsNumber()
  @Min(1)
  @Max(80)
  radius?: number;

  @ValidateIf((dto: AdSetAudienceDto) => Boolean(dto.city?.trim()))
  @IsEnum(MetaDistanceUnit)
  distanceUnit?: MetaDistanceUnit;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsArray()
  locations?: Array<Record<string, unknown>>;

  @IsInt()
  @Min(18)
  @Max(65)
  ageMin: number;

  @IsInt()
  @Min(18)
  @Max(65)
  ageMax: number;

  @IsEnum(MetaGender)
  gender: MetaGender;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  behaviors?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  demographics?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customAudiences?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludedCustomAudiences?: string[];
}

export class AdSetDevicePlatformsDto {
  @IsBoolean()
  mobile: boolean;

  @IsBoolean()
  desktop: boolean;
}

export class AdSetPublisherPlatformsDto {
  @IsBoolean()
  facebook: boolean;

  @IsBoolean()
  instagram: boolean;

  @IsOptional()
  @IsBoolean()
  audienceNetwork?: boolean;

  @IsOptional()
  @IsBoolean()
  messenger?: boolean;
}

export class AdSetFacebookPositionsDto {
  @IsBoolean()
  feed: boolean;

  @IsBoolean()
  story: boolean;

  @IsBoolean()
  reels: boolean;

  @IsBoolean()
  marketplace: boolean;

  @IsBoolean()
  videoFeeds: boolean;

  @IsOptional()
  @IsBoolean()
  rightHandColumn?: boolean;
}

export class AdSetInstagramPositionsDto {
  @IsBoolean()
  stream: boolean;

  @IsBoolean()
  story: boolean;

  @IsBoolean()
  reels: boolean;

  @IsBoolean()
  explore: boolean;
}

export class AdSetPlacementsDto {
  @IsBoolean()
  advantagePlusPlacements: boolean;

  @ValidateNested()
  @Type(() => AdSetDevicePlatformsDto)
  devicePlatforms: AdSetDevicePlatformsDto;

  @ValidateNested()
  @Type(() => AdSetPublisherPlatformsDto)
  publisherPlatforms: AdSetPublisherPlatformsDto;

  @ValidateNested()
  @Type(() => AdSetFacebookPositionsDto)
  facebookPositions: AdSetFacebookPositionsDto;

  @ValidateNested()
  @Type(() => AdSetInstagramPositionsDto)
  instagramPositions: AdSetInstagramPositionsDto;
}

export class SaveAdSetStepDto {
  @IsUUID()
  draftId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(MetaCampaignStatus)
  status: MetaCampaignStatus;

  @IsOptional()
  @IsEnum(MetaAdSetBudgetType)
  budgetType?: MetaAdSetBudgetType;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  dailyBudget?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  lifetimeBudget?: number;

  @IsEnum(MetaBidStrategy)
  bidStrategy: MetaBidStrategy;

  @ValidateIf(
    (dto: SaveAdSetStepDto) =>
      dto.bidStrategy === MetaBidStrategy.LOWEST_COST_WITH_BID_CAP ||
      dto.bidStrategy === MetaBidStrategy.COST_CAP,
  )
  @IsNumber()
  @Min(0.01)
  bidAmount?: number;

  @IsEnum(MetaBillingEvent)
  billingEvent: MetaBillingEvent;

  @IsString()
  @IsNotEmpty()
  startDate: string;

  @IsString()
  @IsNotEmpty()
  startTime: string;

  @IsString()
  @IsNotEmpty()
  endDate: string;

  @IsString()
  @IsNotEmpty()
  endTime: string;

  @IsString()
  @IsNotEmpty()
  timezone: string;

  @IsEnum(MetaOptimizationGoal)
  optimizationGoal: MetaOptimizationGoal;

  @IsEnum(MetaDestinationType)
  destinationType: MetaDestinationType;

  @IsOptional()
  @ValidateNested()
  @Type(() => AdSetPromotedObjectDto)
  promotedObject?: AdSetPromotedObjectDto;

  @ValidateNested()
  @Type(() => AdSetAudienceDto)
  audience: AdSetAudienceDto;

  @ValidateNested()
  @Type(() => AdSetPlacementsDto)
  placements: AdSetPlacementsDto;
}
