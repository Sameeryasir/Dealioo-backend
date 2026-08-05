import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserFacebookAttributionsTable1779950000000
  implements MigrationInterface
{
  name = 'CreateUserFacebookAttributionsTable1779950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_facebook_attributions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer NOT NULL,
        "fbclid" character varying(255),
        "fbc" character varying(255),
        "fbp" character varying(255),
        "captured_at" TIMESTAMPTZ NOT NULL,
        "source" character varying(64) NOT NULL DEFAULT 'anonymous_browser_claim',
        "landing_url" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_facebook_attributions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_facebook_attributions_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_facebook_attributions_user_id"
      ON "user_facebook_attributions" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_user_facebook_attributions_user_id"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "user_facebook_attributions"`,
    );
  }
}
