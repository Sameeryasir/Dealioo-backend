import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiConversationTables1779780000000
  implements MigrationInterface
{
  name = 'CreateAiConversationTables1779780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ai_message_role" AS ENUM (
          'user',
          'assistant'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_conversations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "business_id" integer NOT NULL,
        "funnel_id" integer NOT NULL,
        "created_by" integer NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ai_conversations_business_id"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_conversations_funnel_id"
          FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_conversations_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "uq_ai_conversations_funnel_id"
          UNIQUE ("funnel_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_business_id"
      ON "ai_conversations" ("business_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_created_by"
      ON "ai_conversations" ("created_by")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "role" "ai_message_role" NOT NULL,
        "content" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ai_messages_conversation_id"
          FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_messages_conversation_created"
      ON "ai_messages" ("conversation_id", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_ai_messages_conversation_created"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "ai_messages"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_ai_conversations_created_by"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_ai_conversations_business_id"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "ai_conversations"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "ai_message_role"
    `);
  }
}
