import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MetaCallToAction,
  MetaCampaignObjective,
  MetaDistanceUnit,
  MetaGender,
  MetaSpecialAdCategory,
} from '../meta-campaign.constants';

export class MetaPlacementsDto {
  @IsBoolean()
  facebookFeed: boolean;

  @IsBoolean()
  instagramFeed: boolean;

  @IsBoolean()
  facebookStories: boolean;

  @IsBoolean()
  instagramStories: boolean;

  @IsBoolean()
  reels: boolean;
}

export class CreateFacebookCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(MetaCampaignObjective)
  objective: MetaCampaignObjective;

  @IsOptional()
  @IsString()
  adSetName?: string;

  @IsOptional()
  @IsString()
  adName?: string;

  /** Daily budget in major currency units (e.g. 10 = $10). Converted to cents for Meta. */
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  dailyBudget: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsString()
  @IsNotEmpty()
  country: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(80)
  radius?: number;

  @IsOptional()
  @IsEnum(MetaDistanceUnit)
  distanceUnit?: MetaDistanceUnit;

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

  @ValidateNested()
  @Type(() => MetaPlacementsDto)
  placements: MetaPlacementsDto;

  @IsString()
  @IsNotEmpty()
  facebookPageId: string;

  @IsOptional()
  @IsString()
  instagramActorId?: string;

  @IsString()
  @IsNotEmpty()
  headline: string;

  @IsString()
  @IsNotEmpty()
  primaryText: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUrl({ require_protocol: true, protocols: ['https'] })
  destinationUrl: string;

  @IsEnum(MetaCallToAction)
  callToAction: MetaCallToAction;

  @ValidateIf((dto: CreateFacebookCampaignDto) => !dto.videoUrl?.trim())
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrl?: string;

  @ValidateIf((dto: CreateFacebookCampaignDto) => !dto.imageUrl?.trim())
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  videoUrl?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(MetaSpecialAdCategory, { each: true })
  specialAdCategories?: MetaSpecialAdCategory[];
}
