import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Production invitation table: hashed tokens, status lifecycle, JSONB permissions.
 * Does not create role_permissions — permissions stay static in backend constants.
 */
export class AddBusinessInvitationsTable1779540000000
  implements MigrationInterface
{
  name = 'AddBusinessInvitationsTable1779540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_invitations" (
        "id" SERIAL PRIMARY KEY,
        "business_id" integer NOT NULL,
        "email" character varying(255) NOT NULL,
        "role" character varying(32) NOT NULL,
        "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "token_hash" character varying(64) NOT NULL,
        "status" character varying(32) NOT NULL DEFAULT 'PENDING',
        "invited_by" integer NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "accepted_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_business_invitations_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_business_invitations_invited_by"
          FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_business_invitations_token_hash"
      ON "business_invitations" ("token_hash")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_business_invitations_business_email_status"
      ON "business_invitations" ("business_id", "email", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_business_invitations_business_email_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_business_invitations_token_hash"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "business_invitations"`);
  }
}
