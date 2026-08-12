import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessTrackingTable1786579200007 implements MigrationInterface {
  name = 'CreateBusinessTrackingTable1786579200007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_tracking');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "business_tracking" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "business_id" integer NOT NULL, "pixel_id" character varying(128), "access_token" text, "google_tag_manager_id" character varying(128), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7e4647c2460e3bd635b98be5d2e" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_business_tracking_business_id" ON "business_tracking" ("business_id") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_494040fde1a7b39db318be38154' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_tracking" ADD CONSTRAINT "FK_494040fde1a7b39db318be38154" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_tracking" CASCADE`);
  }
}
