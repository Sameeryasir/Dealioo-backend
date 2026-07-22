import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerVisitCampaignsTable1779672000000
  implements MigrationInterface
{
  name = 'AddCustomerVisitCampaignsTable1779672000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      ADD COLUMN IF NOT EXISTS "order_id" integer NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_customer_visits_order'
        ) THEN
          ALTER TABLE "customer_visits"
          ADD CONSTRAINT "FK_customer_visits_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_visits_order_id"
      ON "customer_visits" ("order_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_visit_campaigns" (
        "id" SERIAL NOT NULL,
        "customer_visit_id" integer NOT NULL,
        "campaign_id" integer NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_visit_campaigns" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_customer_visit_campaigns_visit_campaign"
          UNIQUE ("customer_visit_id", "campaign_id"),
        CONSTRAINT "FK_customer_visit_campaigns_visit"
          FOREIGN KEY ("customer_visit_id") REFERENCES "customer_visits"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_customer_visit_campaigns_campaign"
          FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_visit_campaigns_campaign_id"
      ON "customer_visit_campaigns" ("campaign_id")
    `);

    await queryRunner.query(`
      INSERT INTO "customer_visit_campaigns" ("customer_visit_id", "campaign_id")
      SELECT v."id", v."campaign_id"
      FROM "customer_visits" v
      WHERE v."deleted_at" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "customer_visit_campaigns" cvc
          WHERE cvc."customer_visit_id" = v."id"
            AND cvc."campaign_id" = v."campaign_id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_visit_campaigns"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customer_visits_order_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      DROP CONSTRAINT IF EXISTS "FK_customer_visits_order"
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_visits"
      DROP COLUMN IF EXISTS "order_id"
    `);
  }
}
