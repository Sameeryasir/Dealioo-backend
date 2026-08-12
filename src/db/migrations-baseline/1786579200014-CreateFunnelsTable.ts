import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelsTable1786579200014 implements MigrationInterface {
  name = 'CreateFunnelsTable1786579200014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('funnels');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "funnels" ("id" SERIAL NOT NULL, "campaign_id" integer NOT NULL, "business_id" integer, "published" boolean NOT NULL DEFAULT false, "content_revision" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "updated_by" integer, CONSTRAINT "REL_d29d761207de3aeb3be42d904d" UNIQUE ("campaign_id"), CONSTRAINT "PK_d4a12f72b8c7eb9074e20a415da" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_d29d761207de3aeb3be42d904dd' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnels" ADD CONSTRAINT "FK_d29d761207de3aeb3be42d904dd" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_74edb894fafd195f115539c2000' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnels" ADD CONSTRAINT "FK_74edb894fafd195f115539c2000" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_76d2630b963081edf50834a2a63' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnels" ADD CONSTRAINT "FK_76d2630b963081edf50834a2a63" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnels" CASCADE`);
  }
}
