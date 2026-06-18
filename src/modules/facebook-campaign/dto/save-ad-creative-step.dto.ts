import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  ValidateIf,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
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
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  videoUrl?: string;

  @IsString()
  @IsNotEmpty()
  headline: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUrl({ require_protocol: true, protocols: ['https'] })
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

  @ValidateIf((dto: SaveAdCreativeStepDto) => dto.creativeFormat === MetaCreativeFormat.SINGLE_IMAGE)
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  imageUrl?: string;

  @IsOptional()
  @IsString()
  imageAltText?: string;

  @ValidateIf((dto: SaveAdCreativeStepDto) => dto.creativeFormat === MetaCreativeFormat.SINGLE_VIDEO)
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  videoUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  thumbnailUrl?: string;

  @ValidateIf((dto: SaveAdCreativeStepDto) => dto.creativeFormat === MetaCreativeFormat.CAROUSEL)
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CarouselCardDto)
  carouselCards?: CarouselCardDto[];

  @IsString()
  @IsNotEmpty()
  primaryText: string;

  @ValidateIf((dto: SaveAdCreativeStepDto) => dto.creativeFormat !== MetaCreativeFormat.CAROUSEL)
  @IsString()
  @IsNotEmpty()
  headline?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  displayLink?: string;

  @ValidateIf((dto: SaveAdCreativeStepDto) => dto.creativeFormat !== MetaCreativeFormat.CAROUSEL)
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  destinationUrl?: string;

  @IsOptional()
  @IsString()
  urlParameters?: string;

  @ValidateIf((dto: SaveAdCreativeStepDto) => dto.creativeFormat !== MetaCreativeFormat.CAROUSEL)
  @IsEnum(MetaCallToAction)
  callToAction?: MetaCallToAction;

  @IsOptional()
  @IsString()
  pixelId?: string;

  @IsOptional()
  @IsString()
  conversionEvent?: string;
}
