import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConversationTable1786579200062 implements MigrationInterface {
  name = 'CreateConversationTable1786579200062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('conversation');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "conversation" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "customer_id" integer NOT NULL, "is_private" boolean NOT NULL DEFAULT true, "message_count" integer NOT NULL DEFAULT '0', "last_message_preview" text, "last_message_channel" character varying(16), "last_message_at" TIMESTAMP WITH TIME ZONE, "last_automation_id" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_conversation_business_customer" UNIQUE ("business_id", "customer_id"), CONSTRAINT "PK_864528ec4274360a40f66c29845" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_2d4a361b96d816b262f9216ae2a' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation" ADD CONSTRAINT "FK_2d4a361b96d816b262f9216ae2a" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_8cb887e01c7aa9c10555da04aff' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation" ADD CONSTRAINT "FK_8cb887e01c7aa9c10555da04aff" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_7ff91410992be80a1b54995b464' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "conversation" ADD CONSTRAINT "FK_7ff91410992be80a1b54995b464" FOREIGN KEY ("last_automation_id") REFERENCES "automation"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation" CASCADE`);
  }
}
