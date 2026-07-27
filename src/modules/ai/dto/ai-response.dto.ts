import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export class AiResponseDto {
  @IsBoolean()
  success: boolean;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsObject()
  schema?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  operationId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
