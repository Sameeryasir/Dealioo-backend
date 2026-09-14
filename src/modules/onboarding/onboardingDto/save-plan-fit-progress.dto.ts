import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PartialPlanFitAnswersDto {
  @IsOptional()
  @IsIn(['one', 'few', 'many'])
  businesses?: 'one' | 'few' | 'many';

  @IsOptional()
  @IsIn(['diy', 'ai', 'expert'])
  helpStyle?: 'diy' | 'ai' | 'expert';

  @IsOptional()
  @IsIn(['lean', 'growth', 'expert', 'custom'])
  budget?: 'lean' | 'growth' | 'expert' | 'custom';

  @IsOptional()
  @IsIn(['simple', 'automation', 'guidance', 'scale'])
  priority?: 'simple' | 'automation' | 'guidance' | 'scale';
}

export class SavePlanFitProgressDto {
  @ValidateNested()
  @Type(() => PartialPlanFitAnswersDto)
  answers!: PartialPlanFitAnswersDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  questionIndex?: number;
}
