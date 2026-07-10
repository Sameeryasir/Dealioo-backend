import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionPlanTables1779430000000 implements MigrationInterface {
  name = 'AddSubscriptionPlanTables1779430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription_plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" character varying NOT NULL,
        "name" character varying NOT NULL,
        "description" jsonb,
        "monthlyPrice" numeric(10,2),
        "yearlyPrice" numeric(10,2),
        "stripeMonthlyPriceId" character varying,
        "stripeYearlyPriceId" character varying,
        "currency" character varying NOT NULL DEFAULT 'USD',
        "isActive" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscription_plans" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscription_plans_slug" UNIQUE ("slug")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_plans"`);
  }
}
