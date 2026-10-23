import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordSetupTokensTable1786579200153 implements MigrationInterface {
  name = 'CreatePasswordSetupTokensTable1786579200153';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('password_setup_tokens');
    if (!hasTable) {
      await queryRunner.query(`
        CREATE TABLE "password_setup_tokens" (
          "id" SERIAL NOT NULL,
          "token_hash" character varying(64) NOT NULL,
          "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
          "used_at" TIMESTAMP WITH TIME ZONE,
          "revoked_at" TIMESTAMP WITH TIME ZONE,
          "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "user_id" integer,
          CONSTRAINT "PK_password_setup_tokens" PRIMARY KEY ("id")
        )
      `);
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_password_setup_tokens_token_hash"
        ON "password_setup_tokens" ("token_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_password_setup_tokens_user_id"
        ON "password_setup_tokens" ("user_id")
    `);

    const fkRows = await queryRunner.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'FK_password_setup_tokens_user' LIMIT 1`,
    );
    if (!fkRows.length) {
      await queryRunner.query(`
        ALTER TABLE "password_setup_tokens"
          ADD CONSTRAINT "FK_password_setup_tokens_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "password_setup_tokens" CASCADE`,
    );
  }
}
