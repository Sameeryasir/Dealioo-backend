import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SelectUserPlanDto {
  @IsString()
  @IsNotEmpty()
  planSlug: string;

  @IsIn(['monthly', 'annual'])
  billingCycle: 'monthly' | 'annual';
}
