import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropMemberInvitesTable1779550000000 implements MigrationInterface {
  name = 'DropMemberInvitesTable1779550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_member_invites_business_email"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_member_invites_token"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "member_invites"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "member_invites" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "email" character varying(255) NOT NULL,
        "role" character varying(32) NOT NULL,
        "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "token" character varying(128) NOT NULL,
        "invited_by_user_id" integer NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "accepted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_member_invites" PRIMARY KEY ("id"),
        CONSTRAINT "FK_member_invites_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_member_invites_invited_by"
          FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_member_invites_role"
          CHECK ("role" IN ('Manager', 'Staff'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_member_invites_token"
      ON "member_invites" ("token")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_member_invites_business_email"
      ON "member_invites" ("business_id", "email")
    `);
  }
}
