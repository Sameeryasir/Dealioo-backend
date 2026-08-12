import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFacebookConnectionsTable1786579200039 implements MigrationInterface {
  name = 'CreateFacebookConnectionsTable1786579200039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('facebook_connections');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "facebook_connections" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "facebook_access_token" text NOT NULL, "facebook_user_id" character varying(64) NOT NULL, "facebook_user_name" character varying(255), "expiry" TIMESTAMP WITH TIME ZONE, "connected_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4751b9dd8f063aed892b8120d6e" UNIQUE ("user_id"), CONSTRAINT "PK_0fd717fb2b1a95f3e0bd650c752" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_4751b9dd8f063aed892b8120d6e' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "facebook_connections" ADD CONSTRAINT "FK_4751b9dd8f063aed892b8120d6e" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "facebook_connections" CASCADE`);
  }
}
