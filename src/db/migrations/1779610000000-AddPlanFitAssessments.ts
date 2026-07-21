import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanFitAssessments1779610000000 implements MigrationInterface {
  name = 'AddPlanFitAssessments1779610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "plan_fit_scores" jsonb NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "plan_fit_version" varchar(32) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "plan_fit_confidence" varchar(16) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "plan_fit_selected_plan" varchar(64) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "plan_fit_recommendation_accepted" boolean NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plan_fit_assessments" (
        "id" SERIAL PRIMARY KEY,
        "user_id" int NOT NULL,
        "version" varchar(32) NOT NULL,
        "answers" jsonb NOT NULL,
        "scores" jsonb NOT NULL,
        "recommended_plan_slug" varchar(64) NOT NULL,
        "confidence" varchar(16) NOT NULL,
        "selected_plan_slug" varchar(64) NULL,
        "recommendation_accepted" boolean NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_plan_fit_assessments_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_plan_fit_assessments_user_id"
      ON "plan_fit_assessments" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_plan_fit_assessments_user_id"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "plan_fit_assessments"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "plan_fit_recommendation_accepted"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "plan_fit_selected_plan"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "plan_fit_confidence"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "plan_fit_version"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "plan_fit_scores"
    `);
  }
}
