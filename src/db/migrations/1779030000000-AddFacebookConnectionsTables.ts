import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFacebookConnectionsTables1779030000000
  implements MigrationInterface
{
  name = 'AddFacebookConnectionsTables1779030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "facebook_connections" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "facebook_access_token" text NOT NULL,
        "facebook_user_id" character varying(64) NOT NULL,
        "facebook_user_name" character varying(255),
        "expiry" TIMESTAMPTZ,
        "connected_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_facebook_connections" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_facebook_connections_user_id" UNIQUE ("user_id"),
        CONSTRAINT "FK_facebook_connections_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "facebook_pages" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "connection_id" integer NOT NULL,
        "page_id" character varying(64) NOT NULL,
        "page_name" character varying(255) NOT NULL,
        "page_access_token" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_facebook_pages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_facebook_pages_connection_id" FOREIGN KEY ("connection_id") REFERENCES "facebook_connections"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_facebook_pages_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_facebook_pages_user_id"
      ON "facebook_pages" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "facebook_pages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "facebook_connections"`);
  }
}
