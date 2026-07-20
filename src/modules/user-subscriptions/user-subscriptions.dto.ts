import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SelectUserPlanDto {
  @IsString()
  @IsNotEmpty()
  planSlug!: string;

  @IsIn(['monthly', 'annual'])
  billingCycle!: 'monthly' | 'annual';
}

export class CancelSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
