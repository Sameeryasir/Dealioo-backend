import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessTrackingTable1779890000000
  implements MigrationInterface
{
  name = 'CreateBusinessTrackingTable1779890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_tracking" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "business_id" integer NOT NULL,
        "pixel_id" character varying(128),
        "access_token" text,
        "google_tag_manager_id" character varying(128),
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_tracking" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_business_tracking_business_id"
      ON "business_tracking" ("business_id")
    `);

    if (await queryRunner.hasTable('businesses')) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'FK_business_tracking_business'
          ) THEN
            ALTER TABLE "business_tracking"
            ADD CONSTRAINT "FK_business_tracking_business"
            FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
            ON DELETE CASCADE;
          END IF;
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_tracking"
      DROP CONSTRAINT IF EXISTS "FK_business_tracking_business"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_business_tracking_business_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "business_tracking"`);
  }
}
