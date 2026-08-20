export class GoogleAdsConversionGoalDto {
  category: string;
  origin: string;
  name: string;
  sourceLabel: string;
  actionCount: number;
  accountDefault: boolean;
}

export class GoogleAdsConversionGoalsResponseDto {
  customerId: string | null;
  goals: GoogleAdsConversionGoalDto[];
}
