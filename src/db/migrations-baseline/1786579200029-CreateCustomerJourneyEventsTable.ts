import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerJourneyEventsTable1786579200029 implements MigrationInterface {
  name = 'CreateCustomerJourneyEventsTable1786579200029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customer_journey_events');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "customer_journey_events" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "customer_id" integer NOT NULL, "campaign_id" integer NOT NULL, "funnel_id" integer, "step" character varying(32) NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "source" character varying(64) NOT NULL, "ref_type" character varying(64), "ref_id" character varying(64), "idempotency_key" character varying(160) NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b48a4fd8027d95c04ff1541cd98" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customer_journey_idempotency" ON "customer_journey_events" ("idempotency_key") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_customer_journey_lookup" ON "customer_journey_events" ("business_id", "customer_id", "campaign_id", "step") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_2d88aad0de8dacb456a2a6538ed' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_journey_events" ADD CONSTRAINT "FK_2d88aad0de8dacb456a2a6538ed" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_91195afde6d6f5a939b00bf3f65' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_journey_events" ADD CONSTRAINT "FK_91195afde6d6f5a939b00bf3f65" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_c9c530af1b971c24ad0e69b843a' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_journey_events" ADD CONSTRAINT "FK_c9c530af1b971c24ad0e69b843a" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_d94df57958773f48b98d3101e9d' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_journey_events" ADD CONSTRAINT "FK_d94df57958773f48b98d3101e9d" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_journey_events" CASCADE`);
  }
}
