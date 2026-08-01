import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateGoogleDraftProgressDto {
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @IsInt()
  @Min(1)
  @Max(11)
  currentStep: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  goalDetailSubstep?: number;
}
