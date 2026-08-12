import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOtpsTable1786579200030 implements MigrationInterface {
  name = 'CreateOtpsTable1786579200030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('otps');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "otps" ("id" SERIAL NOT NULL, "code" character varying NOT NULL, "is_used" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE, "user_id" integer, CONSTRAINT "PK_91fef5ed60605b854a2115d2410" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_3938bb24b38ad395af30230bded' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "otps" ADD CONSTRAINT "FK_3938bb24b38ad395af30230bded" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "otps" CASCADE`);
  }
}
