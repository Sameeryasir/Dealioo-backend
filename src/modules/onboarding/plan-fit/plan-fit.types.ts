export enum BusinessCount {
  ONE = 'one',
  FEW = 'few',
  MANY = 'many',
}

export enum HelpStyle {
  DIY = 'diy',
  AI = 'ai',
  EXPERT = 'expert',
}

/** Comfortable monthly spend — maps to real plan price bands. */
export enum BudgetBand {
  LEAN = 'lean',
  GROWTH = 'growth',
  EXPERT = 'expert',
  CUSTOM = 'custom',
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

export const PLAN_FIT_VERSION = '2026-v3';

export const PLAN_ORDER: readonly PlanFitPlanSlug[] = [
  PlanFitPlanSlug.STARTER,
  PlanFitPlanSlug.GROWTH_AI,
  PlanFitPlanSlug.GROWTH_EXPERT,
  PlanFitPlanSlug.ENTERPRISE,
];

export type PlanFitAnswersInput = {
  businesses: BusinessCount;
  helpStyle: HelpStyle;
  budget: BudgetBand;
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
