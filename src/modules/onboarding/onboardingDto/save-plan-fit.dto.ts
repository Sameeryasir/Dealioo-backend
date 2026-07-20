import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class PlanFitAnswersDto {
  @IsIn(['one', 'few', 'many'])
  businesses: 'one' | 'few' | 'many';

  @IsIn(['yes', 'somewhat', 'no'])
  paidMarketing: 'yes' | 'somewhat' | 'no';

  @IsIn(['diy', 'ai', 'expert'])
  helpStyle: 'diy' | 'ai' | 'expert';

  @IsIn(['simple', 'automation', 'guidance', 'scale'])
  priority: 'simple' | 'automation' | 'guidance' | 'scale';
}

export class SavePlanFitDto {
  @ValidateNested()
  @Type(() => PlanFitAnswersDto)
  answers: PlanFitAnswersDto;

  @IsString()
  @IsNotEmpty()
  @IsIn(['starter', 'growth-ai', 'growth-expert', 'enterprise'])
  recommendedPlanSlug: string;
}
