import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserFacebookAttributionsTable1786579200035 implements MigrationInterface {
  name = 'CreateUserFacebookAttributionsTable1786579200035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('user_facebook_attributions');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "user_facebook_attributions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" integer NOT NULL, "fbclid" character varying(255), "fbc" character varying(255), "fbp" character varying(255), "captured_at" TIMESTAMP WITH TIME ZONE NOT NULL, "source" character varying(64) NOT NULL DEFAULT 'anonymous_browser_claim', "landing_url" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3fd9000527de3b22023804af8f9" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_facebook_attributions_user_id" ON "user_facebook_attributions" ("user_id") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_69ead85bd36a7b53385d6222e68' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "user_facebook_attributions" ADD CONSTRAINT "FK_69ead85bd36a7b53385d6222e68" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_facebook_attributions" CASCADE`);
  }
}
