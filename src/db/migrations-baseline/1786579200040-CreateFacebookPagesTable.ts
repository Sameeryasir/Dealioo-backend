import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFacebookPagesTable1786579200040 implements MigrationInterface {
  name = 'CreateFacebookPagesTable1786579200040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('facebook_pages');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "facebook_pages" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "connection_id" integer NOT NULL, "page_id" character varying(64) NOT NULL, "page_name" character varying(255) NOT NULL, "page_access_token" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_496674684a6f17fd3aee100be28" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_0dbd261ba6d8b700a2890638878' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "facebook_pages" ADD CONSTRAINT "FK_0dbd261ba6d8b700a2890638878" FOREIGN KEY ("connection_id") REFERENCES "facebook_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "facebook_pages" CASCADE`);
  }
}
