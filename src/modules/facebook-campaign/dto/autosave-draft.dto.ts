import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';

export class AutosaveDraftDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  currentStep?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  completedSteps?: number[];

  @IsOptional()
  @IsObject()
  campaignData?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  adSetData?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  adCreativeData?: Record<string, unknown>;
}
