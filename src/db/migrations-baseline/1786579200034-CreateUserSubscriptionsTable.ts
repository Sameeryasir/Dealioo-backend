import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserSubscriptionsTable1786579200034 implements MigrationInterface {
  name = 'CreateUserSubscriptionsTable1786579200034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('user_subscriptions');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "user_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" integer NOT NULL, "plan_id" uuid NOT NULL, "billing_cycle" character varying(16) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'active', "stripe_customer_id" character varying, "stripe_subscription_id" character varying, "cancel_at_period_end" boolean NOT NULL DEFAULT false, "cancel_requested_at" TIMESTAMP WITH TIME ZONE, "cancellation_reason" character varying(255), "cancellation_comment" text, "cancels_at" TIMESTAMP WITH TIME ZONE, "started_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9e928b0954e51705ab44988812c" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_0641da02314913e28f6131310eb' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "user_subscriptions" ADD CONSTRAINT "FK_0641da02314913e28f6131310eb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_fe0520c7b2c1c5792446086491f' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "user_subscriptions" ADD CONSTRAINT "FK_fe0520c7b2c1c5792446086491f" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_subscriptions" CASCADE`);
  }
}
