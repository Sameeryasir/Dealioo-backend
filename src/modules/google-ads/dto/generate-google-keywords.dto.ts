import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';

export class GenerateGoogleKeywordsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  productsServices: string[];

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  businessCategory?: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsString()
  goalLabel?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  idealCustomers?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ageRanges?: string[];

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  interests?: string[];

  @IsOptional()
  @IsString()
  locationHint?: string;
}
