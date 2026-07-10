import { config } from 'dotenv';
import { resolve } from 'path';
import { Client } from 'pg';

config({ path: resolve(__dirname, '../.env') });

type PlanFeatureGroup = {
  label: string;
  items: string[];
};

type PlanPricingTier = {
  price: string;
  period: string;
  promo: string | null;
  subline: string | null;
};

type PlanDescription = {
  badge: string | null;
  tagline: string;
  summary: string;
  features?: string[];
  featureGroups?: PlanFeatureGroup[];
  cta: string;
  highlighted: boolean;
  salesEmail?: string | null;
  color: string;
  monthly: PlanPricingTier;
  annual: PlanPricingTier;
};

type SeedPlan = {
  slug: string;
  name: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  stripeMonthlyPriceId?: string | null;
  stripeYearlyPriceId?: string | null;
  sortOrder: number;
  description: PlanDescription;
};

const PLANS: SeedPlan[] = [
  {
    slug: 'starter',
    name: 'Starter',
    monthlyPrice: 29,
    yearlyPrice: 290,
    stripeMonthlyPriceId: 'price_1TrSVBBcqvA02I2jf14kyBqa',
    sortOrder: 1,
    description: {
      badge: 'Perfect for small businesses',
      tagline: 'Perfect for businesses getting started.',
      summary: 'Ideal for businesses managing marketing in-house.',
      features: [
        'One location',
        'DIY Campaign Builder',
        'Landing pages',
        'QR redemption',
        'Stripe checkout',
        'Customer CRM',
        'Analytics',
      ],
      cta: 'Get Started',
      highlighted: false,
      color: '#1877F2',
      monthly: {
        price: '$29',
        period: '/ month',
        promo: null,
        subline: 'Billed monthly',
      },
      annual: {
        price: '$24',
        period: '/ mo',
        promo: null,
        subline: 'Billed annually ($290/year)',
      },
    },
  },
  {
    slug: 'growth-ai',
    name: 'Growth AI',
    monthlyPrice: 99,
    yearlyPrice: 990,
    stripeMonthlyPriceId: 'price_1TrSVXBcqvA02I2jeLbjijvm',
    sortOrder: 2,
    description: {
      badge: 'Most Popular ⭐',
      tagline: 'Everything you need to grow with AI.',
      summary: 'Everything in Starter, powered by AI.',
      features: [
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
      cta: 'Start Now',
      highlighted: true,
      color: '#E1306C',
      monthly: {
        price: '$99',
        period: '/ month',
        promo: null,
        subline: 'Billed monthly',
      },
      annual: {
        price: '$82',
        period: '/ mo',
        promo: null,
        subline: 'Billed annually ($990/year)',
      },
    },
  },
  {
    slug: 'growth-expert',
    name: 'Growth Expert',
    monthlyPrice: 299,
    yearlyPrice: 2990,
    stripeMonthlyPriceId: 'price_1TrSWKBcqvA02I2j01dtit80',
    sortOrder: 3,
    description: {
      badge: 'Best ROI',
      tagline: 'AI plus a dedicated marketing expert.',
      summary: 'Everything in Growth AI—with a dedicated marketing expert.',
      featureGroups: [
        { label: 'Included', items: ['Everything in Growth AI'] },
        {
          label: 'Expert Services',
          items: [
            'Dedicated marketing expert',
            'Monthly strategy session',
            'Weekly strategy call',
            'Campaign reviews',
            'Creative feedback',
            'Growth strategy',
            'Campaign recommendations',
            'Priority support',
          ],
        },
      ],
      cta: 'Talk to Us',
      highlighted: false,
      salesEmail: 'support@dealioo.com',
      color: '#833ABA',
      monthly: {
        price: '$299',
        period: '/ month',
        promo: null,
        subline: 'Billed monthly',
      },
      annual: {
        price: '$249',
        period: '/ mo',
        promo: null,
        subline: 'Billed annually ($2,990/year)',
      },
    },
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: null,
    yearlyPrice: null,
    sortOrder: 4,
    description: {
      badge: 'Contact Sales',
      tagline: 'Built for multi-location businesses.',
      summary: 'Custom plans for multi-location brands and franchises.',
      features: [
        'Unlimited locations',
        'Multi-location & franchise',
        'White label',
        'Dedicated success manager',
        'API access',
        'Custom AI',
        'SLA',
      ],
      cta: 'Contact Sales',
      highlighted: false,
      salesEmail: 'support@dealioo.com',
      color: '#833ABA',
      monthly: {
        price: 'Custom',
        period: '',
        promo: null,
        subline: null,
      },
      annual: {
        price: 'Custom',
        period: '',
        promo: null,
        subline: null,
      },
    },
  },
];

async function upsertPlan(db: Client, plan: SeedPlan): Promise<void> {
  await db.query(
    `
      INSERT INTO "subscription_plans" (
        "slug",
        "name",
        "description",
        "monthlyPrice",
        "yearlyPrice",
        "stripeMonthlyPriceId",
        "stripeYearlyPriceId",
        "currency",
        "isActive",
        "sortOrder",
        "updatedAt"
      ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, 'USD', true, $8, now())
      ON CONFLICT ("slug") DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "monthlyPrice" = EXCLUDED."monthlyPrice",
        "yearlyPrice" = EXCLUDED."yearlyPrice",
        "stripeMonthlyPriceId" = EXCLUDED."stripeMonthlyPriceId",
        "stripeYearlyPriceId" = EXCLUDED."stripeYearlyPriceId",
        "isActive" = true,
        "sortOrder" = EXCLUDED."sortOrder",
        "updatedAt" = now()
    `,
    [
      plan.slug,
      plan.name,
      JSON.stringify(plan.description),
      plan.monthlyPrice,
      plan.yearlyPrice,
      plan.stripeMonthlyPriceId ?? null,
      plan.stripeYearlyPriceId ?? null,
      plan.sortOrder,
    ],
  );
}

async function main(): Promise<void> {
  const db = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5433,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:
      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  await db.connect();

  try {
    for (const plan of PLANS) {
      await upsertPlan(db, plan);
      console.log(`Seeded ${plan.slug}`);
    }

    const activeSlugs = PLANS.map((plan) => plan.slug);
    await db.query(
      `
        UPDATE "subscription_plans"
        SET "isActive" = false, "updatedAt" = now()
        WHERE NOT ("slug" = ANY($1::text[]))
      `,
      [activeSlugs],
    );

    console.log(`Done. ${PLANS.length} subscription plans upserted.`);
  } finally {
    await db.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
