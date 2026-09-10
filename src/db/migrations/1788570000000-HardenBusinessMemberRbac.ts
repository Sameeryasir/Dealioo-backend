import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenBusinessMemberRbac1788570000000
  implements MigrationInterface
{
  name = 'HardenBusinessMemberRbac1788570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "roles" ("name")
      VALUES ('Owner')
      ON CONFLICT ("name") DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD COLUMN IF NOT EXISTS "status" character varying(32) NOT NULL DEFAULT 'active'
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD COLUMN IF NOT EXISTS "invited_by" integer NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD COLUMN IF NOT EXISTS "joined_at" TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_business_members_invited_by'
        ) THEN
          ALTER TABLE "business_members"
          ADD CONSTRAINT "FK_business_members_invited_by"
          FOREIGN KEY ("invited_by") REFERENCES "users"("id")
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      UPDATE "business_members"
      SET "joined_at" = "created_at"
      WHERE "joined_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "CHK_business_members_role"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD CONSTRAINT "CHK_business_members_role"
      CHECK ("role" IN ('Owner', 'Manager', 'Staff'))
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "CHK_business_members_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD CONSTRAINT "CHK_business_members_status"
      CHECK ("status" IN ('active', 'inactive'))
    `);

    await queryRunner.query(`
      INSERT INTO "business_members" (
        "business_id",
        "user_id",
        "role",
        "role_id",
        "permissions",
        "status",
        "joined_at",
        "created_at",
        "updated_at"
      )
      SELECT
        b."id",
        b."owner_id",
        'Owner',
        (SELECT r."id" FROM "roles" r WHERE r."name" = 'Owner' LIMIT 1),
        '[]'::jsonb,
        'active',
        COALESCE(b."created_at", NOW()),
        NOW(),
        NOW()
      FROM "businesses" b
      WHERE b."owner_id" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "business_members" bm
          WHERE bm."business_id" = b."id"
            AND bm."user_id" = b."owner_id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "business_members"
      WHERE "role" = 'Owner'
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "CHK_business_members_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "CHK_business_members_role"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      ADD CONSTRAINT "CHK_business_members_role"
      CHECK ("role" IN ('Manager', 'Staff'))
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP CONSTRAINT IF EXISTS "FK_business_members_invited_by"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP COLUMN IF EXISTS "joined_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP COLUMN IF EXISTS "invited_by"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_members"
      DROP COLUMN IF EXISTS "status"
    `);

    await queryRunner.query(`
      DELETE FROM "roles"
      WHERE "name" = 'Owner'
        AND NOT EXISTS (
          SELECT 1 FROM "users" WHERE "users"."role_id" = "roles"."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "business_members" WHERE "business_members"."role_id" = "roles"."id"
        )
    `);
  }
}
