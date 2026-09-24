import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CampaignPublicationStatus,
} from '../../../db/entities/campaign.entity';

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @Matches(/^(?=.*\p{L}.*\p{L})(?!^[\d\s\W_]+$).+$/u, {
    message:
      'Campaign name must include letters — numbers alone are not allowed.',
  })
  campaignName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { message: 'websiteUrl must be a valid http or https URL' },
  )
  websiteUrl?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(4096)
  @Matches(/^(?!data:)(?!blob:).+$/i, {
    message:
      'imageUrl cannot be a base64 data: or blob: URL. Use multipart field "file" to upload, or send a path like /uploads/campaigns/... or an https URL.',
  })
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^(?=.*\p{L}.*\p{L})(?!^[\d\s\W_]+$).+$/u, {
    message: 'Offer name must include letters — numbers alone are not allowed.',
  })
  offer?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(80)
  @Matches(/^(?=.*\p{L}.*\p{L})(?!^[\d\s\W_]+$).+$/u, {
    message:
      'Description must include letters — numbers alone are not allowed.',
  })
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  price?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) {
      return null;
    }
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : value;
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  originalPrice?: number | null;

  @IsOptional()
  @IsEnum(CampaignPublicationStatus)
  status?: CampaignPublicationStatus;
}
