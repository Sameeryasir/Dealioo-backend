import {
  IsInt,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class EditUiDto {
  @IsInt()
  @IsPositive()
  businessId!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  campaignId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  funnelId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pageId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  userInstruction!: string;

  @IsOptional()
  @IsObject()
  editableFields?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  fieldConstraints?: Record<string, string[]>;

  @IsOptional()
  @IsObject()
  currentSchema?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  correlationId?: string;
}
