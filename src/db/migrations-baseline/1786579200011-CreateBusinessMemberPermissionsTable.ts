import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessMemberPermissionsTable1786579200011 implements MigrationInterface {
  name = 'CreateBusinessMemberPermissionsTable1786579200011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_member_permissions');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "business_member_permissions" ("id" SERIAL NOT NULL, "permission" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "business_member_id" integer NOT NULL, CONSTRAINT "PK_1bf784800a2b0bdc8f14f27950f" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_business_member_permissions_member_id" ON "business_member_permissions" ("business_member_id") `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_business_member_permissions_member_permission" ON "business_member_permissions" ("business_member_id", "permission") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_ba66e515a97268d506d496b6f26' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_member_permissions" ADD CONSTRAINT "FK_ba66e515a97268d506d496b6f26" FOREIGN KEY ("business_member_id") REFERENCES "business_members"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_member_permissions" CASCADE`);
  }
}
