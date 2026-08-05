import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeleteProfessionalSubscriptionPlan1779960000000
  implements MigrationInterface
{
  name = 'DeleteProfessionalSubscriptionPlan1779960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "user_subscriptions"
      WHERE "plan_id" IN (
        SELECT "id" FROM "subscription_plans"
        WHERE "slug" = 'professional' OR LOWER("name") = 'professional'
      )
    `);

    await queryRunner.query(`
      DELETE FROM "subscription_plans"
      WHERE "slug" = 'professional' OR LOWER("name") = 'professional'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "subscription_plans" (
        "id",
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
        "createdAt",
        "updatedAt"
      )
      VALUES (
        '766cd8fe-cfbe-4c3d-8d7a-fe940ecb09f0',
        'professional',
        'Professional',
        $1::jsonb,
        79.00,
        790.00,
        NULL,
        NULL,
        'USD',
        true,
        2,
        NOW(),
        NOW()
      )
      ON CONFLICT ("slug") DO NOTHING
    `,
      [
        JSON.stringify({
          cta: 'Start Now',
          summary: 'Best for growing businesses',
          tagline: 'Best for growing businesses.',
          features: [
            'Everything in Starter',
            'AI Campaign Builder',
            'AI Email & SMS Automation',
            'Unlimited campaigns',
          ],
          highlighted: false,
          annualSubline: 'Billed annually ($790/year)',
          monthlySubline: 'Billed monthly',
        }),
      ],
    );
  }
}
