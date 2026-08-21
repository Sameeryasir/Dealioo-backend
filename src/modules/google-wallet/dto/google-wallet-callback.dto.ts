import { IsObject, IsOptional, IsString } from 'class-validator';

export class GoogleWalletCallbackDto {
  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsString()
  objectId?: string;

  @IsOptional()
  @IsString()
  classId?: string;

  @IsOptional()
  @IsString()
  nonce?: string;

  @IsOptional()
  @IsString()
  signedMessage?: string;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsString()
  protocolVersion?: string;

  @IsOptional()
  @IsObject()
  intermediateSigningKey?: Record<string, unknown>;
}
