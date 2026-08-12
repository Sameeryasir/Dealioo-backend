import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationConnectionTable1786579200055 implements MigrationInterface {
  name = 'CreateAutomationConnectionTable1786579200055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation_connection');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation_connection" ("id" SERIAL NOT NULL, "automation_id" integer NOT NULL, "source_node_id" integer NOT NULL, "target_node_id" integer NOT NULL, CONSTRAINT "PK_554a9db2be1bf0d8cc9fb561844" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_b7ef9aa641b4eec82b6a6fdbf29' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_connection" ADD CONSTRAINT "FK_b7ef9aa641b4eec82b6a6fdbf29" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_5789c21b5dbbf517c1eda626146' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_connection" ADD CONSTRAINT "FK_5789c21b5dbbf517c1eda626146" FOREIGN KEY ("source_node_id") REFERENCES "automation_node"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_c0fa65dca22e76a7574b2d82351' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation_connection" ADD CONSTRAINT "FK_c0fa65dca22e76a7574b2d82351" FOREIGN KEY ("target_node_id") REFERENCES "automation_node"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_connection" CASCADE`);
  }
}
