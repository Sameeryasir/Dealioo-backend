import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConversationMessageTable1786579200063 implements MigrationInterface {
  name = 'CreateConversationMessageTable1786579200063';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('conversation_message');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "conversation_message" ("id" SERIAL NOT NULL, "conversation_id" integer NOT NULL, "automation_id" integer, "execution_id" integer, "node_id" integer, "channel" character varying(16) NOT NULL, "direction" character varying(16) NOT NULL DEFAULT 'outbound', "sent_by_business_id" integer, "sent_by_customer_id" integer, "sent_to_business_id" integer, "sent_to_customer_id" integer, "body" text NOT NULL, "metadata" jsonb, "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL, "idempotency_key" character varying(160) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2f8286c3560b52dba8428ac182e" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_fde1a45d37dfea0608d6f6166a7' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_fde1a45d37dfea0608d6f6166a7" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_016483833b1a62d109c1255cba8' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_016483833b1a62d109c1255cba8" FOREIGN KEY ("automation_id") REFERENCES "automation"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_589e112207ac9f4f3154dabfd8e' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_589e112207ac9f4f3154dabfd8e" FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_b51aba3d0dfac4a3ab2b2c3a675' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_b51aba3d0dfac4a3ab2b2c3a675" FOREIGN KEY ("node_id") REFERENCES "automation_node"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_ecfc685e6cd48179288f89cec16' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_ecfc685e6cd48179288f89cec16" FOREIGN KEY ("sent_by_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_de82657e8c8c845e98d3188aa71' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_de82657e8c8c845e98d3188aa71" FOREIGN KEY ("sent_by_customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_f77961b5d14b4f9984577e42431' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_f77961b5d14b4f9984577e42431" FOREIGN KEY ("sent_to_business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_26729905c64bbfa19f5c813eea1' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_26729905c64bbfa19f5c813eea1" FOREIGN KEY ("sent_to_customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_message" CASCADE`);
  }
}
