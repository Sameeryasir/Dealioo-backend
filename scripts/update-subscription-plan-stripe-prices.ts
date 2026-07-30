/**
 * Update subscription_plans Stripe price IDs by slug.
 *
 * What it does:
 * 1. Loads active DB from .env
 * 2. Finds each plan by slug
 * 3. Updates stripeMonthlyPriceId / stripeYearlyPriceId from STRIPE_PRICE_BY_SLUG
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/update-subscription-plan-stripe-prices.ts
 *   npx ts-node -r tsconfig-paths/register scripts/update-subscription-plan-stripe-prices.ts --dry-run
 *
 * Edit STRIPE_PRICE_BY_SLUG below before running.
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import AppDataSource from '../src/data-source';
import { SubscriptionPlan } from '../src/db/entities/subscription-plan.entity';

config();

type StripePricePair = {
  monthly: string | null;
  yearly: string | null;
};

/**
 * Source of truth for Stripe Price IDs (price_...).
 * null = clear the DB column. Omit a slug entirely to leave that plan unchanged.
 */
const STRIPE_PRICE_BY_SLUG: Record<string, StripePricePair> = {
  starter: {
    monthly: 'price_1TtpdgBcqvA02I2jzf8n0M31',
    yearly: 'price_1TtpeWBcqvA02I2j87IfVORO',
  },
  'growth-ai': {
    monthly: 'price_1TtpipBcqvA02I2j5qzo443v',
    yearly: 'price_1TtpjGBcqvA02I2jnbWSSMg0',
  },
  professional: {
    monthly: null,
    yearly: null,
  },
  'growth-expert': {
    monthly: 'price_1TtplcBcqvA02I2j8o1TI9zq',
    yearly: 'price_1TtpmQBcqvA02I2j7aBWXcFZ',
  },
  enterprise: {
    monthly: null,
    yearly: null,
  },
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(SubscriptionPlan);

  console.log(
    dryRun
      ? 'Dry run — no DB writes will be made.'
      : 'Updating subscription_plans Stripe price IDs…',
  );
  console.log(
    `DB: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
  );

  const plans = await repo.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  if (plans.length === 0) {
    console.log('No subscription plans found.');
    await AppDataSource.destroy();
    return;
  }

  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const [slug, prices] of Object.entries(STRIPE_PRICE_BY_SLUG)) {
    const plan = plans.find((row) => row.slug === slug);
    if (!plan) {
      console.log(`MISSING slug="${slug}" — not in DB, skipped`);
      missing += 1;
      continue;
    }

    const beforeMonthly = plan.stripeMonthlyPriceId ?? null;
    const beforeYearly = plan.stripeYearlyPriceId ?? null;
    const nextMonthly = prices.monthly?.trim() || null;
    const nextYearly = prices.yearly?.trim() || null;

    if (beforeMonthly === nextMonthly && beforeYearly === nextYearly) {
      console.log(
        `OK     ${slug} — already up to date (monthly=${nextMonthly ?? 'null'}, yearly=${nextYearly ?? 'null'})`,
      );
      skipped += 1;
      continue;
    }

    console.log(`UPDATE ${slug}`);
    console.log(`  monthly: ${beforeMonthly ?? 'null'} -> ${nextMonthly ?? 'null'}`);
    console.log(`  yearly:  ${beforeYearly ?? 'null'} -> ${nextYearly ?? 'null'}`);

    if (!dryRun) {
      plan.stripeMonthlyPriceId = nextMonthly;
      plan.stripeYearlyPriceId = nextYearly;
      await repo.save(plan);
    }
    updated += 1;
  }

  // Show any DB plans not covered by the map.
  for (const plan of plans) {
    if (!(plan.slug in STRIPE_PRICE_BY_SLUG)) {
      console.log(
        `UNMAPPED slug="${plan.slug}" name="${plan.name}" monthly=${plan.stripeMonthlyPriceId ?? 'null'} yearly=${plan.stripeYearlyPriceId ?? 'null'}`,
      );
    }
  }

  console.log('---');
  console.log(
    `Done. updated=${updated} unchanged=${skipped} missingFromDb=${missing} dryRun=${dryRun}`,
  );

  await AppDataSource.destroy();
}

main().catch(async (err) => {
  console.error(err);
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(1);
});
