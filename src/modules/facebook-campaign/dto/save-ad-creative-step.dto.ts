import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { normalizeMetaHttpsUrl } from '../../../utils/normalize-meta-https-url';
import {
  MetaCallToAction,
  MetaCampaignStatus,
  MetaCreativeFormat,
} from '../meta-campaign.constants';

export class CarouselCardDto {
  @IsOptional()
  @IsString()
  mediaType?: 'image' | 'video';

  @IsOptional()
  @Transform(({ value }) => normalizeMetaHttpsUrl(value))
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeMetaHttpsUrl(value))
  @IsString()
  videoUrl?: string;

  @IsString()
  @IsNotEmpty()
  headline: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Transform(({ value }) => normalizeMetaHttpsUrl(value))
  @IsString()
  @IsNotEmpty()
  destinationUrl: string;

  @IsEnum(MetaCallToAction)
  callToAction: MetaCallToAction;
}

export class SaveAdCreativeStepDto {
  @IsUUID()
  draftId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  facebookPageId: string;

  @IsOptional()
  @IsString()
  instagramActorId?: string;

  @IsEnum(MetaCampaignStatus)
  status: MetaCampaignStatus;

  @IsEnum(MetaCreativeFormat)
  creativeFormat: MetaCreativeFormat;

  @ValidateIf(
    (dto: SaveAdCreativeStepDto) =>
      dto.creativeFormat === MetaCreativeFormat.SINGLE_IMAGE,
  )
  @Transform(({ value }) => normalizeMetaHttpsUrl(value))
  @IsString()
  @IsNotEmpty()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  imageAltText?: string;

  @ValidateIf(
    (dto: SaveAdCreativeStepDto) =>
      dto.creativeFormat === MetaCreativeFormat.SINGLE_VIDEO,
  )
  @Transform(({ value }) => normalizeMetaHttpsUrl(value))
  @IsString()
  @IsNotEmpty()
  videoUrl?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeMetaHttpsUrl(value))
  @IsString()
  thumbnailUrl?: string;

  @ValidateIf(
    (dto: SaveAdCreativeStepDto) =>
      dto.creativeFormat === MetaCreativeFormat.CAROUSEL,
  )
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CarouselCardDto)
  carouselCards?: CarouselCardDto[];

  @IsString()
  @IsNotEmpty()
  primaryText: string;

  @ValidateIf(
    (dto: SaveAdCreativeStepDto) =>
      dto.creativeFormat !== MetaCreativeFormat.CAROUSEL,
  )
  @IsString()
  @IsNotEmpty()
  headline?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  displayLink?: string;

  @ValidateIf(
    (dto: SaveAdCreativeStepDto) =>
      dto.creativeFormat !== MetaCreativeFormat.CAROUSEL,
  )
  @Transform(({ value }) => normalizeMetaHttpsUrl(value))
  @IsString()
  @IsNotEmpty()
  destinationUrl?: string;

  @IsOptional()
  @IsString()
  urlParameters?: string;

  @ValidateIf(
    (dto: SaveAdCreativeStepDto) =>
      dto.creativeFormat !== MetaCreativeFormat.CAROUSEL,
  )
  @IsEnum(MetaCallToAction)
  callToAction?: MetaCallToAction;

  @IsOptional()
  @IsString()
  pixelId?: string;

  @IsOptional()
  @IsString()
  conversionEvent?: string;

  @IsOptional()
  @IsBoolean()
  brandingEnabled?: boolean;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeMetaHttpsUrl(value))
  @IsString()
  brandLogoUrl?: string;
}
