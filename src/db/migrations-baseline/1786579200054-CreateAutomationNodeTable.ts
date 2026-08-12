import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationNodeTable1786579200054 implements MigrationInterface {
  name = 'CreateAutomationNodeTable1786579200054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_node');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation_node" ("id" SERIAL NOT NULL, "automation_id" integer NOT NULL, "type" "public"."automation_node_type_enum" NOT NULL, "config" jsonb NOT NULL DEFAULT '{}', "position_x" integer NOT NULL DEFAULT '0', "position_y" integer NOT NULL DEFAULT '0', "node_order" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c6750539c56b3f14ffbbdfeae11" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_aba16a7e347891c1dd1295b672c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_node" ADD CONSTRAINT "FK_aba16a7e347891c1dd1295b672c" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_node" CASCADE`);
  }
}
