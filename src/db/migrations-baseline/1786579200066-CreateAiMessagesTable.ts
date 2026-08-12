import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiMessagesTable1786579200066 implements MigrationInterface {
  name = 'CreateAiMessagesTable1786579200066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('ai_messages');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "ai_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "role" "public"."ai_message_role" NOT NULL, "content" text NOT NULL, "page_id" "public"."ai_message_page", "status" "public"."ai_message_status" NOT NULL DEFAULT 'COMPLETED', "job_id" character varying(255), "schema_patch" jsonb, "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a390434d4a515ba18a41bc996c2" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_messages_job_id" ON "ai_messages" ("job_id") `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_ai_messages_conversation_created" ON "ai_messages" ("conversation_id", "created_at") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_de21fcb2d1df7fd6ca70f555b6d' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "ai_messages" ADD CONSTRAINT "FK_de21fcb2d1df7fd6ca70f555b6d" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_messages" CASCADE`);
  }
}
