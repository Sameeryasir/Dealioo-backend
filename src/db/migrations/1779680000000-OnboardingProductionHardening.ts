import { MigrationInterface, QueryRunner } from 'typeorm';

export class OnboardingProductionHardening1779680000000
  implements MigrationInterface
{
  name = 'OnboardingProductionHardening1779680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "onboarding_version" varchar(32) NOT NULL DEFAULT '2026-v1',
        ADD COLUMN IF NOT EXISTS "plan_fit_draft_answers" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "plan_fit_draft_question_index" int NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_onboarding_drafts" (
        "id" SERIAL PRIMARY KEY,
        "user_id" int NOT NULL,
        "step" varchar(32) NOT NULL DEFAULT 'basics',
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "logo_url" text NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_business_onboarding_drafts_user"
          UNIQUE ("user_id"),
        CONSTRAINT "FK_business_onboarding_drafts_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "onboarding_events" (
        "id" SERIAL PRIMARY KEY,
        "user_id" int NULL,
        "event_name" varchar(64) NOT NULL,
        "idempotency_key" varchar(191) NOT NULL,
        "metadata" jsonb NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_onboarding_events_idempotency"
          UNIQUE ("idempotency_key"),
        CONSTRAINT "FK_onboarding_events_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_onboarding_events_user_created"
        ON "onboarding_events" ("user_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_onboarding_events_user_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "onboarding_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "business_onboarding_drafts"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "plan_fit_draft_question_index",
        DROP COLUMN IF EXISTS "plan_fit_draft_answers",
        DROP COLUMN IF EXISTS "onboarding_version"
    `);
  }
}
