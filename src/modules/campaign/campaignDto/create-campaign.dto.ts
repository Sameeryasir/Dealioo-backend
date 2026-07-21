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
import { CampaignPublicationStatus } from '../../../db/entities/campaign.entity';

export class CreateCampaignDto {
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  businessId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  campaignName!: string;

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
  websiteUrl!: string;

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

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  offer!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  price!: number;

  @IsOptional()
  @IsEnum(CampaignPublicationStatus)
  status?: CampaignPublicationStatus;
}
