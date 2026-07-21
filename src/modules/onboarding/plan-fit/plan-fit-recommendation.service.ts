import { Injectable } from '@nestjs/common';
import {
  contentBonus,
  fallbackPlanContents,
  needsFromAnswers,
  resolvePlanFeatures,
  type PlanContentInput,
} from './plan-fit-content';
import {
  BusinessCount,
  HelpStyle,
  PaidMarketing,
  PLAN_FIT_VERSION,
  PLAN_ORDER,
  PlanFitAnswersInput,
  PlanFitConfidence,
  PlanFitPlanSlug,
  PlanFitRecommendationResult,
  PlanFitScoreBreakdown,
  Priority,
} from './plan-fit.types';

const EMPTY_SCORES = (): PlanFitScoreBreakdown => ({
  starter: 0,
  growthAi: 0,
  growthExpert: 0,
  enterprise: 0,
});

const REASONS: Record<PlanFitPlanSlug, string> = {
  [PlanFitPlanSlug.STARTER]:
    'Best fit for a single business that wants simple DIY campaigns.',
  [PlanFitPlanSlug.GROWTH_AI]:
    'Best fit when you want AI tools and automated follow-ups.',
  [PlanFitPlanSlug.GROWTH_EXPERT]:
    'Best fit when you want AI plus a dedicated marketing expert.',
  [PlanFitPlanSlug.ENTERPRISE]:
    'Best fit for multi-business brands that need a custom plan.',
};

const PRIORITY_PLAN: Record<Priority, PlanFitPlanSlug> = {
  [Priority.SIMPLE]: PlanFitPlanSlug.STARTER,
  [Priority.AUTOMATION]: PlanFitPlanSlug.GROWTH_AI,
  [Priority.GUIDANCE]: PlanFitPlanSlug.GROWTH_EXPERT,
  [Priority.SCALE]: PlanFitPlanSlug.ENTERPRISE,
};

const HELP_PLAN: Record<HelpStyle, PlanFitPlanSlug> = {
  [HelpStyle.DIY]: PlanFitPlanSlug.STARTER,
  [HelpStyle.AI]: PlanFitPlanSlug.GROWTH_AI,
  [HelpStyle.EXPERT]: PlanFitPlanSlug.GROWTH_EXPERT,
};

@Injectable()
export class PlanFitRecommendationService {
  recommend(
    answers: PlanFitAnswersInput,
    planContents: PlanContentInput[] = fallbackPlanContents(),
  ): PlanFitRecommendationResult {
    const scores = this.buildScores(answers, planContents);
    const planSlug = this.pickWinner(scores, answers);
    const ranked = this.rank(scores);
    const confidence = this.confidence(
      ranked[0]?.score ?? 0,
      ranked[1]?.score ?? 0,
    );

    return {
      planSlug,
      reason: REASONS[planSlug],
      confidence,
      scores,
      version: PLAN_FIT_VERSION,
    };
  }

  private buildScores(
    answers: PlanFitAnswersInput,
    planContents: PlanContentInput[],
  ): PlanFitScoreBreakdown {
    const scores = EMPTY_SCORES();

    if (answers.businesses === BusinessCount.ONE) {
      scores.starter += 3;
      scores.growthAi += 1;
    } else if (answers.businesses === BusinessCount.FEW) {
      scores.growthAi += 2;
      scores.growthExpert += 2;
      scores.enterprise += 1;
    } else {
      scores.enterprise += 4;
      scores.growthExpert += 1;
    }

    if (answers.paidMarketing === PaidMarketing.YES) {
      scores.growthAi += 3;
      scores.growthExpert += 2;
    } else if (answers.paidMarketing === PaidMarketing.SOMEWHAT) {
      scores.growthAi += 2;
      scores.starter += 1;
    } else {
      scores.starter += 3;
    }

    if (answers.helpStyle === HelpStyle.DIY) {
      scores.starter += 3;
      scores.growthAi += 1;
    } else if (answers.helpStyle === HelpStyle.AI) {
      scores.growthAi += 4;
      scores.growthExpert += 1;
    } else {
      scores.growthExpert += 4;
      scores.enterprise += 1;
    }

    if (answers.priority === Priority.SIMPLE) {
      scores.starter += 4;
    } else if (answers.priority === Priority.AUTOMATION) {
      scores.growthAi += 4;
    } else if (answers.priority === Priority.GUIDANCE) {
      scores.growthExpert += 4;
    } else {
      scores.enterprise += 4;
    }

    const needs = needsFromAnswers(answers);
    for (const slug of PLAN_ORDER) {
      const features = resolvePlanFeatures(slug, planContents);
      const bonus = contentBonus(features, needs);
      this.addScore(scores, slug, bonus);
    }

    if (answers.businesses !== BusinessCount.ONE) {
      scores.starter = 0;
    }

    return scores;
  }

  private addScore(
    scores: PlanFitScoreBreakdown,
    slug: PlanFitPlanSlug,
    points: number,
  ): void {
    if (points <= 0) {
      return;
    }
    switch (slug) {
      case PlanFitPlanSlug.STARTER:
        scores.starter += points;
        break;
      case PlanFitPlanSlug.GROWTH_AI:
        scores.growthAi += points;
        break;
      case PlanFitPlanSlug.GROWTH_EXPERT:
        scores.growthExpert += points;
        break;
      case PlanFitPlanSlug.ENTERPRISE:
        scores.enterprise += points;
        break;
      default:
        break;
    }
  }

  private pickWinner(
    scores: PlanFitScoreBreakdown,
    answers: PlanFitAnswersInput,
  ): PlanFitPlanSlug {
    const eligible = PLAN_ORDER.filter((plan) =>
      this.isEligible(plan, answers),
    );
    if (eligible.length === 0) {
      return PlanFitPlanSlug.GROWTH_AI;
    }

    return eligible.reduce((best, next) =>
      this.isBetter(next, best, scores, answers) ? next : best,
    );
  }

  private isEligible(
    plan: PlanFitPlanSlug,
    answers: PlanFitAnswersInput,
  ): boolean {
    if (plan === PlanFitPlanSlug.STARTER) {
      return answers.businesses === BusinessCount.ONE;
    }
    return true;
  }

  private isBetter(
    a: PlanFitPlanSlug,
    b: PlanFitPlanSlug,
    scores: PlanFitScoreBreakdown,
    answers: PlanFitAnswersInput,
  ): boolean {
    const scoreA = this.scoreOf(scores, a);
    const scoreB = this.scoreOf(scores, b);
    if (scoreA !== scoreB) {
      return scoreA > scoreB;
    }

    const byPriority = PRIORITY_PLAN[answers.priority];
    if ((a === byPriority) !== (b === byPriority)) {
      return a === byPriority;
    }

    const byHelp = HELP_PLAN[answers.helpStyle];
    if ((a === byHelp) !== (b === byHelp)) {
      return a === byHelp;
    }

    return PLAN_ORDER.indexOf(a) < PLAN_ORDER.indexOf(b);
  }

  private rank(
    scores: PlanFitScoreBreakdown,
  ): Array<{ slug: PlanFitPlanSlug; score: number }> {
    return PLAN_ORDER.map((slug) => ({
      slug,
      score: this.scoreOf(scores, slug),
    })).sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return PLAN_ORDER.indexOf(a.slug) - PLAN_ORDER.indexOf(b.slug);
    });
  }

  private scoreOf(
    scores: PlanFitScoreBreakdown,
    slug: PlanFitPlanSlug,
  ): number {
    switch (slug) {
      case PlanFitPlanSlug.STARTER:
        return scores.starter;
      case PlanFitPlanSlug.GROWTH_AI:
        return scores.growthAi;
      case PlanFitPlanSlug.GROWTH_EXPERT:
        return scores.growthExpert;
      case PlanFitPlanSlug.ENTERPRISE:
        return scores.enterprise;
      default:
        return 0;
    }
  }

  private confidence(
    topScore: number,
    secondScore: number,
  ): PlanFitConfidence {
    const gap = Math.max(0, topScore - secondScore);
    if (gap >= 4) {
      return PlanFitConfidence.HIGH;
    }
    if (gap >= 2) {
      return PlanFitConfidence.MEDIUM;
    }
    return PlanFitConfidence.LOW;
  }
}
