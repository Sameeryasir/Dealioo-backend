import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { SubscriptionPlan } from '../src/db/entities/subscription-plan.entity';
import type { SubscriptionPlanDescription } from '../src/db/entities/subscription-plan.entity';

config();

type PlanSeed = {
  slug: string;
  name: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  stripeMonthlyPriceId: string | null;
  stripeYearlyPriceId: string | null;
  sortOrder: number;
  description: SubscriptionPlanDescription;
};

const PLANS: PlanSeed[] = [
  {
    slug: 'starter',
    name: 'Starter',
    monthlyPrice: 29,
    yearlyPrice: 290,
    stripeMonthlyPriceId: 'price_1TtpdgBcqvA02I2jzf8n0M31',
    stripeYearlyPriceId: 'price_1TtpeWBcqvA02I2j87IfVORO',
    sortOrder: 0,
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
      color: '#E1306C',
      monthly: {
        price: '$29',
        period: '/ month',
        originalPrice: null,
        promo: null,
        subline: 'Billed monthly',
      },
      annual: {
        price: '$24',
        period: '/ mo',
        originalPrice: null,
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
    stripeMonthlyPriceId: 'price_1TtpipBcqvA02I2j5qzo443v',
    stripeYearlyPriceId: 'price_1TtpjGBcqvA02I2jnbWSSMg0',
    sortOrder: 1,
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
        originalPrice: null,
        promo: null,
        subline: 'Billed monthly',
      },
      annual: {
        price: '$82',
        period: '/ mo',
        originalPrice: null,
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
    stripeMonthlyPriceId: 'price_1TtplcBcqvA02I2j8o1TI9zq',
    stripeYearlyPriceId: 'price_1TtpmQBcqvA02I2j7aBWXcFZ',
    sortOrder: 2,
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
      salesEmail: 'support@dealioo.com',
      cta: 'Talk to Us',
      highlighted: false,
      color: '#833ABA',
      monthly: {
        price: '$299',
        period: '/ month',
        originalPrice: '$500',
        promo: null,
        subline: 'Billed monthly',
      },
      annual: {
        price: '$249',
        period: '/ mo',
        originalPrice: null,
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
    stripeMonthlyPriceId: null,
    stripeYearlyPriceId: null,
    sortOrder: 3,
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
      salesEmail: 'support@dealioo.com',
      cta: 'Contact Sales',
      highlighted: false,
      color: '#833ABA',
      monthly: {
        price: 'Custom',
        period: '',
        originalPrice: null,
        promo: null,
        subline: null,
      },
      annual: {
        price: 'Custom',
        period: '',
        originalPrice: null,
        promo: null,
        subline: null,
      },
    },
  },
];

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(SubscriptionPlan);

  let inserted = 0;
  let updated = 0;

  const plans = [
    ...PLANS.filter((plan) => plan.slug !== 'enterprise'),
    ...PLANS.filter((plan) => plan.slug === 'enterprise'),
  ].map((plan, index) => ({ ...plan, sortOrder: index }));

  for (const seed of plans) {
    const existing = await repo.findOne({ where: { slug: seed.slug } });
    if (!existing) {
      await repo.save(
        repo.create({
          slug: seed.slug,
          name: seed.name,
          description: seed.description,
          monthlyPrice: seed.monthlyPrice,
          yearlyPrice: seed.yearlyPrice,
          stripeMonthlyPriceId: seed.stripeMonthlyPriceId,
          stripeYearlyPriceId: seed.stripeYearlyPriceId,
          currency: 'USD',
          isActive: true,
          sortOrder: seed.sortOrder,
        }),
      );
      inserted += 1;
      console.log(`INSERT ${seed.slug}`);
      continue;
    }

    existing.name = seed.name;
    existing.description = seed.description;
    existing.monthlyPrice = seed.monthlyPrice;
    existing.yearlyPrice = seed.yearlyPrice;
    existing.stripeMonthlyPriceId = seed.stripeMonthlyPriceId;
    existing.stripeYearlyPriceId = seed.stripeYearlyPriceId;
    existing.currency = 'USD';
    existing.isActive = true;
    existing.sortOrder = seed.sortOrder;
    await repo.save(existing);
    updated += 1;
    console.log(`UPDATE ${seed.slug}`);
  }

  const rows = await repo.find({ order: { sortOrder: 'ASC' } });
  console.log('---');
  console.log(`Done. inserted=${inserted} updated=${updated}`);
  for (const row of rows) {
    console.log(
      `${row.sortOrder} ${row.slug} monthly=${row.monthlyPrice ?? 'null'} yearly=${row.yearlyPrice ?? 'null'}`,
    );
  }

  await AppDataSource.destroy();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
