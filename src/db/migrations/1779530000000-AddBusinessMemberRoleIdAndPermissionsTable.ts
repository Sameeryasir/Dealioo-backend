import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessMemberRoleIdAndPermissionsTable1779530000000
  implements MigrationInterface
{
  name = 'AddBusinessMemberRoleIdAndPermissionsTable1779530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD COLUMN "role_id" integer
    `);

    await queryRunner.query(`
      UPDATE "business_members" AS bm
      SET "role_id" = r."id"
      FROM "roles" AS r
      WHERE LOWER(r."name") = LOWER(bm."role")
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD CONSTRAINT "FK_business_members_role"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id")
      ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_business_members_role_id"
      ON "business_members" ("role_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "business_member_permissions" (
        "id" SERIAL NOT NULL,
        "business_member_id" integer NOT NULL,
        "permission" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_member_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_business_member_permissions_member"
          FOREIGN KEY ("business_member_id")
          REFERENCES "business_members"("id")
          ON DELETE CASCADE,
        CONSTRAINT "CHK_business_member_permissions_permission"
          CHECK (
            "permission" IN (
              'campaigns',
              'meta_ads',
              'meta_campaigns',
              'orders',
              'activity',
              'chats',
              'scanning',
              'members',
              'settings'
            )
          )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_business_member_permissions_member_permission"
      ON "business_member_permissions" ("business_member_id", "permission")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_business_member_permissions_member_id"
      ON "business_member_permissions" ("business_member_id")
    `);

    await queryRunner.query(`
      INSERT INTO "business_member_permissions" ("business_member_id", "permission")
      SELECT
        bm."id",
        perm.value
      FROM "business_members" AS bm
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE
          WHEN jsonb_typeof(bm."permissions") = 'array' THEN bm."permissions"
          ELSE '[]'::jsonb
        END
      ) AS perm(value)
      WHERE perm.value IN (
        'campaigns',
        'meta_ads',
        'meta_campaigns',
        'orders',
        'activity',
        'chats',
        'scanning',
        'members',
        'settings'
      )
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_member_permissions"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_business_members_role_id"`,
    );

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "FK_business_members_role"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP COLUMN IF EXISTS "role_id"
    `);
  }
}
