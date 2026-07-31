import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpsertBusinessTrackingDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  pixelId?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  googleTagManagerId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
