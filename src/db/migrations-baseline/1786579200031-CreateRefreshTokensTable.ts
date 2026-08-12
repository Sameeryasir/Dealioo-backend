import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefreshTokensTable1786579200031 implements MigrationInterface {
  name = 'CreateRefreshTokensTable1786579200031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('refresh_tokens');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" SERIAL NOT NULL, "token_hash" character varying NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" integer, CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_a7838d2ba25be1342091b6695f" ON "refresh_tokens" ("token_hash") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_3ddc983c5f7bcf132fd8732c3f4' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens" CASCADE`);
  }
}
