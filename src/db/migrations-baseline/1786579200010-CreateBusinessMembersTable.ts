import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessMembersTable1786579200010 implements MigrationInterface {
  name = 'CreateBusinessMembersTable1786579200010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_members');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "business_members" ("id" SERIAL NOT NULL, "role" character varying(32) NOT NULL, "permissions" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_id" integer NOT NULL, "user_id" integer NOT NULL, "role_id" integer, CONSTRAINT "UQ_business_members_business_user" UNIQUE ("business_id", "user_id"), CONSTRAINT "PK_0665f675783d42efe8fb5e5697c" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_123f737f36b33e71fe0b3028fdc' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_members" ADD CONSTRAINT "FK_123f737f36b33e71fe0b3028fdc" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_7a8eebc9f4792ffdc2d350643fe' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_members" ADD CONSTRAINT "FK_7a8eebc9f4792ffdc2d350643fe" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_2c2c8c8afa35aab7826c7ef6930' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_members" ADD CONSTRAINT "FK_2c2c8c8afa35aab7826c7ef6930" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_members" CASCADE`);
  }
}
