import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCampaignReviewTable1786579200123
  implements MigrationInterface
{
  name = 'CreateCampaignReviewTable1786579200123';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('campaign_review');
    if (!hasTable) {
      await queryRunner.query(`
        CREATE TABLE "campaign_review" (
          "id" SERIAL NOT NULL,
          "token_hash" character varying(64) NOT NULL,
          "business_id" integer NOT NULL,
          "campaign_id" integer NOT NULL,
          "funnel_id" integer,
          "customer_id" integer NOT NULL,
          "automation_id" integer,
          "execution_id" integer,
          "node_id" integer,
          "status" character varying(32) NOT NULL DEFAULT 'pending',
          "rating" smallint,
          "comment" text,
          "guest_name" character varying(255),
          "guest_email" character varying(255),
          "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
          "submitted_at" TIMESTAMP WITH TIME ZONE,
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_campaign_review" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_campaign_review_token_hash" UNIQUE ("token_hash")
        )
      `);
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_campaign_review_campaign_status_created"
      ON "campaign_review" ("campaign_id", "status", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_campaign_review_token_hash"
      ON "campaign_review" ("token_hash")
    `);

    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_campaign_review_campaign' LIMIT 1`,
      );
      if (!rows.length) {
        await queryRunner.query(`
          ALTER TABLE "campaign_review"
          ADD CONSTRAINT "FK_campaign_review_campaign"
          FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
        `);
      }
    }

    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_campaign_review_customer' LIMIT 1`,
      );
      if (!rows.length) {
        await queryRunner.query(`
          ALTER TABLE "campaign_review"
          ADD CONSTRAINT "FK_campaign_review_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
        `);
      }
    }

    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_campaign_review_automation' LIMIT 1`,
      );
      if (!rows.length) {
        await queryRunner.query(`
          ALTER TABLE "campaign_review"
          ADD CONSTRAINT "FK_campaign_review_automation"
          FOREIGN KEY ("automation_id") REFERENCES "automation"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
        `);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaign_review" DROP CONSTRAINT IF EXISTS "FK_campaign_review_automation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_review" DROP CONSTRAINT IF EXISTS "FK_campaign_review_customer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_review" DROP CONSTRAINT IF EXISTS "FK_campaign_review_campaign"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_campaign_review_token_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_campaign_review_campaign_status_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "campaign_review"`);
  }
}
