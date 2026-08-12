import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessInvitationsTable1786579200012 implements MigrationInterface {
  name = 'CreateBusinessInvitationsTable1786579200012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_invitations');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "business_invitations" ("id" SERIAL NOT NULL, "email" character varying(255) NOT NULL, "role" character varying(32) NOT NULL, "permissions" jsonb NOT NULL DEFAULT '[]', "token_hash" character varying(64) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'PENDING', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "accepted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" integer NOT NULL, "invited_by" integer NOT NULL, CONSTRAINT "PK_6961c1a5c94f4c01e2eb6e4b299" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_business_invitations_business_email_status" ON "business_invitations" ("business_id", "email", "status") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_business_invitations_token_hash" ON "business_invitations" ("token_hash") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_be825ea9419529b47aa6cbbaee2' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_invitations" ADD CONSTRAINT "FK_be825ea9419529b47aa6cbbaee2" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_4ad5d3e50403ee6def3d7d1703f' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_invitations" ADD CONSTRAINT "FK_4ad5d3e50403ee6def3d7d1703f" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_invitations" CASCADE`);
  }
}
