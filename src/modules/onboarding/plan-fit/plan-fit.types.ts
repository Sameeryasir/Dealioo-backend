export enum BusinessCount {
  ONE = 'one',
  FEW = 'few',
  MANY = 'many',
}

export enum PaidMarketing {
  YES = 'yes',
  SOMEWHAT = 'somewhat',
  NO = 'no',
}

export enum HelpStyle {
  DIY = 'diy',
  AI = 'ai',
  EXPERT = 'expert',
}

export enum Priority {
  SIMPLE = 'simple',
  AUTOMATION = 'automation',
  GUIDANCE = 'guidance',
  SCALE = 'scale',
}

export enum PlanFitPlanSlug {
  STARTER = 'starter',
  GROWTH_AI = 'growth-ai',
  GROWTH_EXPERT = 'growth-expert',
  ENTERPRISE = 'enterprise',
}

export enum PlanFitConfidence {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export const PLAN_FIT_VERSION = '2026-v2';

export const PLAN_ORDER: readonly PlanFitPlanSlug[] = [
  PlanFitPlanSlug.STARTER,
  PlanFitPlanSlug.GROWTH_AI,
  PlanFitPlanSlug.GROWTH_EXPERT,
  PlanFitPlanSlug.ENTERPRISE,
];

export type PlanFitAnswersInput = {
  businesses: BusinessCount;
  paidMarketing: PaidMarketing;
  helpStyle: HelpStyle;
  priority: Priority;
};

export type PlanFitScoreBreakdown = {
  starter: number;
  growthAi: number;
  growthExpert: number;
  enterprise: number;
};

export type PlanFitRecommendationResult = {
  planSlug: PlanFitPlanSlug;
  reason: string;
  confidence: PlanFitConfidence;
  scores: PlanFitScoreBreakdown;
  version: string;
};
