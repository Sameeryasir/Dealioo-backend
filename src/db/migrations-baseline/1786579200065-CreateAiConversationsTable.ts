import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiConversationsTable1786579200065 implements MigrationInterface {
  name = 'CreateAiConversationsTable1786579200065';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('ai_conversations');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "ai_conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "business_id" integer NOT NULL, "funnel_id" integer NOT NULL, "created_by" integer, "title" character varying(255) NOT NULL DEFAULT 'New chat', "status" "public"."ai_conversation_status" NOT NULL DEFAULT 'ACTIVE', "last_message_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_60db12765b82858ba00c8aa4ae2" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_recent" ON "ai_conversations" ("business_id", "funnel_id", "last_message_at") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_created_by" ON "ai_conversations" ("created_by") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_business_id" ON "ai_conversations" ("business_id") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_funnel_id" ON "ai_conversations" ("funnel_id") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_ceb372acbb47c4f7424963461ae' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_ceb372acbb47c4f7424963461ae" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_3292546a563455f52dbe2f25e4c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_3292546a563455f52dbe2f25e4c" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_8bb06018a63b0fbf718cd267de5' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "ai_conversations" ADD CONSTRAINT "FK_8bb06018a63b0fbf718cd267de5" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_conversations" CASCADE`);
  }
}
