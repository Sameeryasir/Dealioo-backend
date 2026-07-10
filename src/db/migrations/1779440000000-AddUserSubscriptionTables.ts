import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserSubscriptionTables1779440000000 implements MigrationInterface {
  name = 'AddUserSubscriptionTables1779440000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "plan_id" uuid NOT NULL,
        "billing_cycle" character varying(16) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'active',
        "started_at" TIMESTAMP WITH TIME ZONE,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_subscriptions_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_subscriptions_plan"
          FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_user_subscriptions_user_id"
      ON "user_subscriptions" ("user_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_user_subscriptions_one_active_per_user"
      ON "user_subscriptions" ("user_id")
      WHERE "status" = 'active'
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "business_subscriptions"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_subscriptions"`);
  }
}
