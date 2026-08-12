import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLocationsTable1786579200005 implements MigrationInterface {
  name = 'CreateLocationsTable1786579200005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('locations');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "locations" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "address" character varying NOT NULL, "city" character varying NOT NULL, "state" character varying NOT NULL, "country" character varying NOT NULL, "postal_code" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" integer NOT NULL, CONSTRAINT "PK_7cc1c9e3853b94816c094825e74" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_556c5be9ef36f88fc6ce79a4a9a' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "locations" ADD CONSTRAINT "FK_556c5be9ef36f88fc6ce79a4a9a" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "locations" CASCADE`);
  }
}
