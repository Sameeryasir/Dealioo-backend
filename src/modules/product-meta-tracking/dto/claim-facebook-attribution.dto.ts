import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ClaimFacebookAttributionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fbclid!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fbc?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fbp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  landingUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;
}
