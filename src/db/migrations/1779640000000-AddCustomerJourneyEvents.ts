import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerJourneyEvents1779640000000
  implements MigrationInterface
{
  name = 'AddCustomerJourneyEvents1779640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "customer_journey_events" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "campaign_id" integer NOT NULL,
        "funnel_id" integer NULL,
        "step" character varying(32) NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "source" character varying(64) NOT NULL,
        "ref_type" character varying(64) NULL,
        "ref_id" character varying(64) NULL,
        "idempotency_key" character varying(160) NOT NULL,
        "metadata" jsonb NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_journey_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_journey_business"
          FOREIGN KEY ("restaurant_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_journey_customer"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_journey_campaign"
          FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_journey_funnel"
          FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_journey_idempotency"
      ON "customer_journey_events" ("idempotency_key")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_journey_lookup"
      ON "customer_journey_events"
      ("restaurant_id", "customer_id", "campaign_id", "step")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customer_journey_lookup"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_customer_journey_idempotency"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_journey_events"`);
  }
}
