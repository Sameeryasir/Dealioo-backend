import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SyncAutomationConnectionPairDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceNodeId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetNodeId: number;

  @IsOptional()
  @IsString()
  branch?: string | null;
}

export class SyncAutomationConnectionsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  automationId: number;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SyncAutomationConnectionPairDto)
  pairs: SyncAutomationConnectionPairDto[];

  @IsOptional()
  @IsBoolean()
  pruneStale?: boolean;
}
