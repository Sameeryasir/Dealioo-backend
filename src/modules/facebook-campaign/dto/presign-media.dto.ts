import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class PresignMediaDto {
  @IsOptional()
  @IsUUID()
  draftId?: string;

  @IsString()
  @IsIn(['image', 'video'])
  mediaType: 'image' | 'video';

  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  sizeBytes: number;
}

export class PresignMediaResponseDto {
  mediaId: string;
  uploadUrl: string;
  publicUrl: string;
  objectKey: string;
  uploadStatus: string;
  requiredHeaders: Record<string, string>;
}
