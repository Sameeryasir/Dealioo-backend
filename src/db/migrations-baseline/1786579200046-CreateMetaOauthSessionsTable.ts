import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaOauthSessionsTable1786579200046 implements MigrationInterface {
  name = 'CreateMetaOauthSessionsTable1786579200046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('meta_oauth_sessions');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "meta_oauth_sessions" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "requested_scopes" jsonb NOT NULL, "oauth_state" character varying(255) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'INITIATED', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_32b32372791214faa65b85f08df" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_meta_oauth_sessions_business_id" ON "meta_oauth_sessions" ("business_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_meta_oauth_sessions_oauth_state" ON "meta_oauth_sessions" ("oauth_state") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_1a8e698e61b2469747ccc9bc62c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "meta_oauth_sessions" ADD CONSTRAINT "FK_1a8e698e61b2469747ccc9bc62c" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_oauth_sessions" CASCADE`);
  }
}
