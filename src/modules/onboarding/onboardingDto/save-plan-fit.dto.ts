import { Type } from 'class-transformer';
import { IsIn, ValidateNested } from 'class-validator';

export class PlanFitAnswersDto {
  @IsIn(['one', 'few', 'many'])
  businesses!: 'one' | 'few' | 'many';

  @IsIn(['diy', 'ai', 'expert'])
  helpStyle!: 'diy' | 'ai' | 'expert';

  @IsIn(['lean', 'growth', 'expert', 'custom'])
  budget!: 'lean' | 'growth' | 'expert' | 'custom';

  @IsIn(['simple', 'automation', 'guidance', 'scale'])
  priority!: 'simple' | 'automation' | 'guidance' | 'scale';
}

export class SavePlanFitDto {
  @ValidateNested()
  @Type(() => PlanFitAnswersDto)
  answers!: PlanFitAnswersDto;
}
