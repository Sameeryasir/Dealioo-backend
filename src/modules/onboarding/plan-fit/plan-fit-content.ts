import {
  HelpStyle,
  PaidMarketing,
  PlanFitAnswersInput,
  PlanFitPlanSlug,
  Priority,
  BusinessCount,
} from './plan-fit.types';

export type PlanContentInput = {
  slug: string;
  name: string;
  features: string[];
};

const FALLBACK_FEATURES: Record<PlanFitPlanSlug, string[]> = {
  [PlanFitPlanSlug.STARTER]: [
    'One location',
    'DIY Campaign Builder',
    'Landing pages',
    'QR redemption',
    'Stripe checkout',
    'Customer CRM',
    'Analytics',
  ],
  [PlanFitPlanSlug.GROWTH_AI]: [
    'Everything in Starter',
    'AI Deal Generator',
    'AI Image Generation',
    'AI Copywriting',
    'AI Campaign Builder',
    'AI Chat Assistant',
    'AI Follow-ups',
    'AI Email, SMS & WhatsApp Automation',
    'Unlimited campaigns',
  ],
  [PlanFitPlanSlug.GROWTH_EXPERT]: [
    'Everything in Growth AI',
    'Dedicated marketing expert',
    'Monthly strategy session',
    'Weekly strategy call',
    'Campaign reviews',
    'Creative feedback',
    'Growth strategy',
    'Campaign recommendations',
    'Priority support',
  ],
  [PlanFitPlanSlug.ENTERPRISE]: [
    'Unlimited locations',
    'Multi-location & franchise',
    'White label',
    'Dedicated success manager',
    'API access',
    'Custom AI',
    'SLA',
  ],
};

const CONTENT_BONUS_PER_HIT = 2;
const CONTENT_BONUS_CAP = 6;

export function fallbackPlanContents(): PlanContentInput[] {
  return (Object.keys(FALLBACK_FEATURES) as PlanFitPlanSlug[]).map((slug) => ({
    slug,
    name: slug,
    features: FALLBACK_FEATURES[slug],
  }));
}

export function needsFromAnswers(answers: PlanFitAnswersInput): string[] {
  const needs: string[] = [];

  if (answers.businesses === BusinessCount.ONE) {
    needs.push('one location', 'diy campaign');
  } else if (answers.businesses === BusinessCount.FEW) {
    needs.push('unlimited campaigns', 'ai campaign');
  } else {
    needs.push('unlimited locations', 'multi-location', 'franchise');
  }

  if (answers.paidMarketing === PaidMarketing.YES) {
    needs.push('ai campaign', 'ai copy', 'unlimited campaigns');
  } else if (answers.paidMarketing === PaidMarketing.SOMEWHAT) {
    needs.push('ai campaign', 'ai deal');
  } else {
    needs.push('diy campaign', 'qr redemption', 'landing pages');
  }

  if (answers.helpStyle === HelpStyle.DIY) {
    needs.push('diy campaign', 'landing pages', 'qr redemption', 'analytics');
  } else if (answers.helpStyle === HelpStyle.AI) {
    needs.push(
      'ai deal',
      'ai image',
      'ai copy',
      'ai campaign',
      'ai chat',
      'ai follow',
      'automation',
      'email',
      'sms',
      'whatsapp',
    );
  } else {
    needs.push(
      'dedicated marketing expert',
      'strategy',
      'campaign reviews',
      'creative feedback',
      'priority support',
    );
  }

  if (answers.priority === Priority.SIMPLE) {
    needs.push('qr redemption', 'landing pages', 'diy campaign', 'stripe');
  } else if (answers.priority === Priority.AUTOMATION) {
    needs.push('automation', 'email', 'sms', 'ai follow', 'whatsapp');
  } else if (answers.priority === Priority.GUIDANCE) {
    needs.push(
      'dedicated marketing expert',
      'strategy session',
      'strategy call',
      'growth strategy',
    );
  } else {
    needs.push(
      'unlimited locations',
      'multi-location',
      'franchise',
      'white label',
      'api access',
      'sla',
    );
  }

  return [...new Set(needs)];
}

export function contentBonus(
  features: string[],
  needs: string[],
): number {
  if (features.length === 0 || needs.length === 0) {
    return 0;
  }

  const haystack = features.join(' ').toLowerCase();
  let hits = 0;
  for (const need of needs) {
    if (haystack.includes(need.toLowerCase())) {
      hits += 1;
    }
  }

  return Math.min(hits * CONTENT_BONUS_PER_HIT, CONTENT_BONUS_CAP);
}

export function resolvePlanFeatures(
  slug: PlanFitPlanSlug,
  contents: PlanContentInput[],
): string[] {
  const fromCatalog = contents.find((row) => row.slug === slug);
  if (fromCatalog && fromCatalog.features.length > 0) {
    return fromCatalog.features;
  }
  return FALLBACK_FEATURES[slug] ?? [];
}
