import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1786579200001 implements MigrationInterface {
  name = 'CreateUsersTable1786579200001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('users');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "first_name" character varying, "last_name" character varying, "email" character varying NOT NULL, "phone" character varying, "avatar" character varying, "google_id" character varying, "provider" character varying NOT NULL DEFAULT 'LOCAL', "email_verified" boolean NOT NULL DEFAULT false, "phone_verified" boolean NOT NULL DEFAULT false, "password_hash" character varying, "is_active" boolean NOT NULL DEFAULT true, "two_factor_secret" character varying, "two_factor_enabled" boolean NOT NULL DEFAULT false, "is_two_factor_verified" boolean NOT NULL DEFAULT false, "onboarding_step" integer NOT NULL DEFAULT '0', "last_login_at" TIMESTAMP WITH TIME ZONE, "stripe_customer_id" character varying, "plan_fit_answers" jsonb, "plan_fit_recommended_plan" character varying, "plan_fit_completed_at" TIMESTAMP WITH TIME ZONE, "plan_fit_scores" jsonb, "plan_fit_version" character varying(32), "plan_fit_confidence" character varying(16), "plan_fit_selected_plan" character varying(64), "plan_fit_recommendation_accepted" boolean, "onboarding_version" character varying(32) NOT NULL DEFAULT '2026-v1', "plan_fit_draft_answers" jsonb, "plan_fit_draft_question_index" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "role_id" integer NOT NULL, "created_by" integer, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_0bd5012aeb82628e07f6a1be53b" UNIQUE ("google_id"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_google_id" ON "users" ("google_id") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_a2cecd1a3531c0b041e29ba46e1' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_f32b1cb14a9920477bcfd63df2c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_f32b1cb14a9920477bcfd63df2c" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);
  }
}
