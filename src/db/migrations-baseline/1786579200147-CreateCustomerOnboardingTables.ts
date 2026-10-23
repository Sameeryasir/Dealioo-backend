import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerOnboardingTables1786579200147 implements MigrationInterface {
  name = 'CreateCustomerOnboardingTables1786579200147';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      ADD COLUMN IF NOT EXISTS "attendance" character varying(32),
      ADD COLUMN IF NOT EXISTS "sales_outcome" character varying(32),
      ADD COLUMN IF NOT EXISTS "meeting_notes" text,
      ADD COLUMN IF NOT EXISTS "follow_up_notes" text,
      ADD COLUMN IF NOT EXISTS "outcome_updated_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "outcome_updated_by" integer
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meeting_request_attendance"
      ON "meeting_request" ("attendance")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meeting_request_sales_outcome"
      ON "meeting_request" ("sales_outcome")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_onboardings" (
        "id" SERIAL NOT NULL,
        "meeting_id" integer NOT NULL,
        "user_id" integer,
        "business_id" integer,
        "assigned_admin_id" integer,
        "status" character varying(32) NOT NULL,
        "selected_plan_id" integer,
        "customer_name" character varying(255) NOT NULL,
        "customer_email" character varying(255) NOT NULL,
        "customer_phone" character varying(40),
        "business_name" character varying(512) NOT NULL,
        "business_category" character varying(128),
        "draft_payload" jsonb,
        "internal_notes" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "approved_by" integer,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_onboardings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_onboardings_meeting"
          FOREIGN KEY ("meeting_id") REFERENCES "meeting_request"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_customer_onboardings_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_customer_onboardings_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_customer_onboardings_assigned_admin"
          FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_onboarding_meeting_active"
      ON "customer_onboardings" ("meeting_id")
      WHERE "status" NOT IN ('CANCELLED')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_onboardings_status"
      ON "customer_onboardings" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_onboardings_updated_at"
      ON "customer_onboardings" ("updated_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_onboardings_assigned_admin"
      ON "customer_onboardings" ("assigned_admin_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_onboardings_customer_email"
      ON "customer_onboardings" ("customer_email")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "onboarding_tasks" (
        "id" SERIAL NOT NULL,
        "onboarding_id" integer NOT NULL,
        "task_key" character varying(64) NOT NULL,
        "status" character varying(32) NOT NULL,
        "completed_by" integer,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "notes" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_onboarding_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_onboarding_tasks_onboarding"
          FOREIGN KEY ("onboarding_id") REFERENCES "customer_onboardings"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_onboarding_tasks_completed_by"
          FOREIGN KEY ("completed_by") REFERENCES "users"("id")
          ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_onboarding_tasks_onboarding_key"
      ON "onboarding_tasks" ("onboarding_id", "task_key")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "onboarding_tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_onboardings"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meeting_request_sales_outcome"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meeting_request_attendance"`,
    );
    await queryRunner.query(`
      ALTER TABLE "meeting_request"
      DROP COLUMN IF EXISTS "outcome_updated_by",
      DROP COLUMN IF EXISTS "outcome_updated_at",
      DROP COLUMN IF EXISTS "follow_up_notes",
      DROP COLUMN IF EXISTS "meeting_notes",
      DROP COLUMN IF EXISTS "sales_outcome",
      DROP COLUMN IF EXISTS "attendance"
    `);
  }
}
