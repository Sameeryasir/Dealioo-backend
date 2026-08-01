import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMetaOAuthSessionsAndRequestedScopes1779900000000
  implements MigrationInterface
{
  name = 'CreateMetaOAuthSessionsAndRequestedScopes1779900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
      ADD COLUMN IF NOT EXISTS "meta_requested_scopes" text
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "meta_oauth_sessions" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "requested_scopes" jsonb NOT NULL,
        "oauth_state" character varying(255) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'INITIATED',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_meta_oauth_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_meta_oauth_sessions_oauth_state" UNIQUE ("oauth_state")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_meta_oauth_sessions_business_id"
      ON "meta_oauth_sessions" ("business_id")
    `);

    if (await queryRunner.hasTable('businesses')) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'FK_meta_oauth_sessions_business'
          ) THEN
            ALTER TABLE "meta_oauth_sessions"
            ADD CONSTRAINT "FK_meta_oauth_sessions_business"
            FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
            ON DELETE CASCADE;
          END IF;
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meta_oauth_sessions"
      DROP CONSTRAINT IF EXISTS "FK_meta_oauth_sessions_business"
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_meta_oauth_sessions_business_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "meta_oauth_sessions"`);
    await queryRunner.query(`
      ALTER TABLE "businesses"
      DROP COLUMN IF EXISTS "meta_requested_scopes"
    `);
  }
}
