import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubscriptionPlansTable1786579200002 implements MigrationInterface {
  name = 'CreateSubscriptionPlansTable1786579200002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('subscription_plans');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "subscription_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying NOT NULL, "name" character varying NOT NULL, "description" jsonb, "monthlyPrice" numeric(10,2), "yearlyPrice" numeric(10,2), "stripeMonthlyPriceId" character varying, "stripeYearlyPriceId" character varying, "currency" character varying NOT NULL DEFAULT 'USD', "isActive" boolean NOT NULL DEFAULT true, "sortOrder" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_0ebf9b0f0cbd7b2fb5b62e3facb" UNIQUE ("slug"), CONSTRAINT "PK_9ab8fe6918451ab3d0a4fb6bb0c" PRIMARY KEY ("id"))`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription_plans" CASCADE`);
  }
}
