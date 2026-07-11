import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessMembersTables1779470000000
  implements MigrationInterface
{
  name = 'AddBusinessMembersTables1779470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "business_members" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "user_id" integer NOT NULL,
        "role" character varying(32) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_members" PRIMARY KEY ("id"),
        CONSTRAINT "FK_business_members_business"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_business_members_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_business_members_role"
          CHECK ("role" IN ('Manager', 'Staff'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_business_members_business_user"
      ON "business_members" ("business_id", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_business_members_business_id"
      ON "business_members" ("business_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "member_invites" (
        "id" SERIAL NOT NULL,
        "business_id" integer NOT NULL,
        "email" character varying(255) NOT NULL,
        "role" character varying(32) NOT NULL,
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "member_invites"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "business_members"`);
  }
}
