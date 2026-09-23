import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGoogleCampaignsTable1786579200104
  implements MigrationInterface
{
  name = 'CreateGoogleCampaignsTable1786579200104';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('google_campaigns');
    if (!hasTable) {
      await queryRunner.query(`
        CREATE TABLE "google_campaigns" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "user_id" integer,
          "business_id" integer NOT NULL,
          "draft_id" uuid,
          "customer_id" character varying(64) NOT NULL,
          "google_campaign_id" character varying(64),
          "google_budget_id" character varying(64),
          "google_ad_group_id" character varying(64),
          "google_ad_id" character varying(64),
          "google_keyword_ids" jsonb,
          "campaign_name" character varying(255),
          "goal" character varying(64),
          "campaign_type" character varying(64),
          "budget" numeric(12,2),
          "status" character varying(32) NOT NULL DEFAULT 'PENDING',
          "error_message" text,
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_google_campaigns_id" PRIMARY KEY ("id")
        )
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_google_campaigns_business_id"
        ON "google_campaigns" ("business_id")
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_google_campaigns_draft_id"
        ON "google_campaigns" ("draft_id")
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_google_campaigns_google_campaign_id"
        ON "google_campaigns" ("google_campaign_id")
      `);
    }

    await queryRunner.query(`
      INSERT INTO "google_campaigns" (
        "user_id",
        "business_id",
        "draft_id",
        "customer_id",
        "google_campaign_id",
        "google_budget_id",
        "google_ad_group_id",
        "google_ad_id",
        "google_keyword_ids",
        "campaign_name",
        "goal",
        "campaign_type",
        "budget",
        "status",
        "error_message",
        "created_at",
        "updated_at"
      )
      SELECT
        d."user_id",
        d."business_id",
        d."id",
        COALESCE(NULLIF(b."google_customer_id", ''), 'unknown'),
        d."google_campaign_id",
        d."google_budget_id",
        d."google_ad_group_id",
        d."google_ad_id",
        d."google_keyword_ids",
        d."campaign_name",
        d."goal",
        d."campaign_type",
        d."daily_budget",
        CASE
          WHEN UPPER(COALESCE(d."status", '')) = 'PUBLISHED' THEN 'PAUSED'
          WHEN UPPER(COALESCE(d."status", '')) = 'FAILED' THEN 'FAILED'
          ELSE 'PENDING'
        END,
        d."error_message",
        COALESCE(d."published_at", d."created_at", now()),
        COALESCE(d."updated_at", now())
      FROM "google_campaign_drafts" d
      LEFT JOIN "businesses" b ON b."id" = d."business_id"
      WHERE d."google_campaign_id" IS NOT NULL
        AND TRIM(d."google_campaign_id") <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM "google_campaigns" gc
          WHERE gc."draft_id" = d."id"
             OR (
               gc."business_id" = d."business_id"
               AND gc."google_campaign_id" = d."google_campaign_id"
             )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "google_campaigns" CASCADE`);
  }
}
