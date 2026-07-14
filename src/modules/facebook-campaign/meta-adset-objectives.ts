import { MetaCampaignObjective, MetaOptimizationGoal } from './meta-campaign.constants';

export const OPTIMIZATION_GOALS_BY_OBJECTIVE: Record<
  MetaCampaignObjective,
  MetaOptimizationGoal[]
> = {
  [MetaCampaignObjective.OUTCOME_TRAFFIC]: [
    MetaOptimizationGoal.LANDING_PAGE_VIEWS,
    MetaOptimizationGoal.LINK_CLICKS,
    MetaOptimizationGoal.REACH,
    MetaOptimizationGoal.CONVERSATIONS,
    MetaOptimizationGoal.IMPRESSIONS,
  ],
  [MetaCampaignObjective.OUTCOME_LEADS]: [
    MetaOptimizationGoal.OFFSITE_CONVERSIONS,
    MetaOptimizationGoal.LANDING_PAGE_VIEWS,
    MetaOptimizationGoal.LINK_CLICKS,
    MetaOptimizationGoal.REACH,
    MetaOptimizationGoal.IMPRESSIONS,
  ],
  [MetaCampaignObjective.OUTCOME_SALES]: [
    MetaOptimizationGoal.OFFSITE_CONVERSIONS,
  ],
  [MetaCampaignObjective.OUTCOME_ENGAGEMENT]: [
    MetaOptimizationGoal.THRUPLAY,
    MetaOptimizationGoal.TWO_SECOND_CONTINUOUS_VIDEO_VIEWS,
  ],
  [MetaCampaignObjective.OUTCOME_AWARENESS]: [
    MetaOptimizationGoal.REACH,
    MetaOptimizationGoal.IMPRESSIONS,
    MetaOptimizationGoal.AD_RECALL_LIFT,
    MetaOptimizationGoal.THRUPLAY,
    MetaOptimizationGoal.TWO_SECOND_CONTINUOUS_VIDEO_VIEWS,
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
