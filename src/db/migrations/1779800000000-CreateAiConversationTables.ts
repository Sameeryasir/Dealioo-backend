import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiConversationTables1779800000000
  implements MigrationInterface
{
  name = 'CreateAiConversationTables1779800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ai_message_role" AS ENUM ('user', 'assistant');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ai_conversation_status" AS ENUM ('ACTIVE', 'ARCHIVED');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ai_message_status" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "ai_message_page" AS ENUM (
          'landing',
          'signup',
          'payment',
          'confirmation'
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
        "title" varchar(255) NOT NULL DEFAULT 'New chat',
        "status" "ai_conversation_status" NOT NULL DEFAULT 'ACTIVE',
        "last_message_at" TIMESTAMPTZ NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ai_conversations_business_id"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_conversations_funnel_id"
          FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_conversations_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_funnel_id"
      ON "ai_conversations" ("funnel_id")
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
      CREATE INDEX IF NOT EXISTS "IDX_ai_conversations_recent"
      ON "ai_conversations" ("business_id", "funnel_id", "last_message_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "role" "ai_message_role" NOT NULL,
        "content" text NOT NULL,
        "page_id" "ai_message_page" NULL,
        "status" "ai_message_status" NOT NULL DEFAULT 'COMPLETED',
        "job_id" varchar(255) NULL,
        "schema_patch" jsonb NULL,
        "error_message" text NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ai_messages_conversation_id"
          FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_messages_conversation_created"
      ON "ai_messages" ("conversation_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_messages_job_id"
      ON "ai_messages" ("job_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ai_messages_job_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_messages_conversation_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_messages"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_recent"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_created_by"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_business_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_conversations_funnel_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_conversations"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "ai_message_page"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ai_message_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ai_conversation_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ai_message_role"`);
  }
}
