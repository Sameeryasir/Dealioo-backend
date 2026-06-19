import { MetaCampaignObjective, MetaOptimizationGoal } from './meta-campaign.constants';

export const OPTIMIZATION_GOALS_BY_OBJECTIVE: Record<
  MetaCampaignObjective,
  MetaOptimizationGoal[]
> = {
  [MetaCampaignObjective.OUTCOME_TRAFFIC]: [
    MetaOptimizationGoal.LINK_CLICKS,
    MetaOptimizationGoal.LANDING_PAGE_VIEWS,
  ],
  [MetaCampaignObjective.OUTCOME_LEADS]: [MetaOptimizationGoal.LEAD_GENERATION],
  [MetaCampaignObjective.OUTCOME_SALES]: [
    MetaOptimizationGoal.OFFSITE_CONVERSIONS,
  ],
  [MetaCampaignObjective.OUTCOME_ENGAGEMENT]: [
    MetaOptimizationGoal.POST_ENGAGEMENT,
  ],
  [MetaCampaignObjective.OUTCOME_AWARENESS]: [
    MetaOptimizationGoal.REACH,
    MetaOptimizationGoal.IMPRESSIONS,
  ],
};

export function isOptimizationGoalValidForObjective(
  objective: MetaCampaignObjective,
  optimizationGoal: MetaOptimizationGoal,
): boolean {
  return OPTIMIZATION_GOALS_BY_OBJECTIVE[objective]?.includes(
    optimizationGoal,
  );
}

export function defaultOptimizationGoalForObjective(
  objective: MetaCampaignObjective,
): MetaOptimizationGoal {
  return OPTIMIZATION_GOALS_BY_OBJECTIVE[objective][0];
}
