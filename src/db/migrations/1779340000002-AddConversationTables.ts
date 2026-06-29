import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationTables1779340000002 implements MigrationInterface {
  name = 'AddConversationTables1779340000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "is_private" boolean NOT NULL DEFAULT true,
        "message_count" integer NOT NULL DEFAULT 0,
        "last_message_preview" text,
        "last_message_channel" character varying(16),
        "last_message_at" TIMESTAMPTZ,
        "last_automation_id" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conversation_restaurant_customer"
          UNIQUE ("restaurant_id", "customer_id"),
        CONSTRAINT "FK_conversation_restaurant_id"
          FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_conversation_customer_id"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_conversation_last_automation_id"
          FOREIGN KEY ("last_automation_id") REFERENCES "automation"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "conversation_message" (
        "id" SERIAL NOT NULL,
        "conversation_id" integer NOT NULL,
        "automation_id" integer,
        "execution_id" integer,
        "node_id" integer,
        "channel" character varying(16) NOT NULL,
        "direction" character varying(16) NOT NULL DEFAULT 'outbound',
        "body" text NOT NULL,
        "metadata" jsonb,
        "sent_at" TIMESTAMPTZ NOT NULL,
        "idempotency_key" character varying(160) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_message" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_conversation_message_idempotency_key"
          UNIQUE ("idempotency_key"),
        CONSTRAINT "FK_conversation_message_conversation_id"
          FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_conversation_message_automation_id"
          FOREIGN KEY ("automation_id") REFERENCES "automation"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_conversation_message_execution_id"
          FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_conversation_message_node_id"
          FOREIGN KEY ("node_id") REFERENCES "automation_node"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_conversation_restaurant_last_message"
      ON "conversation" ("restaurant_id", "last_message_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_conversation_message_conversation_sent"
      ON "conversation_message" ("conversation_id", "sent_at" ASC)
    `);

    const automationMessageTable = await queryRunner.query(`
      SELECT to_regclass('public.automation_message') AS table_name
    `);

    if (automationMessageTable[0]?.table_name) {
      await queryRunner.query(`
        INSERT INTO "conversation" (
          "restaurant_id",
          "customer_id",
          "is_private",
          "message_count",
          "last_message_at",
          "last_message_preview",
          "last_message_channel",
          "last_automation_id",
          "created_at",
          "updated_at"
        )
        SELECT
          grouped.restaurant_id,
          grouped.customer_id,
          true,
          grouped.message_count,
          grouped.last_message_at,
          latest.body_preview,
          latest.channel,
          latest.automation_id,
          NOW(),
          NOW()
        FROM (
          SELECT
            restaurant_id,
            customer_id,
            COUNT(*)::int AS message_count,
            MAX(sent_at) AS last_message_at
          FROM "automation_message"
          GROUP BY restaurant_id, customer_id
        ) grouped
        JOIN LATERAL (
          SELECT body_preview, channel, automation_id
          FROM "automation_message" am
          WHERE am.restaurant_id = grouped.restaurant_id
            AND am.customer_id = grouped.customer_id
          ORDER BY sent_at DESC
          LIMIT 1
        ) latest ON true
        ON CONFLICT ("restaurant_id", "customer_id") DO NOTHING
      `);

      await queryRunner.query(`
        INSERT INTO "conversation_message" (
          "conversation_id",
          "automation_id",
          "execution_id",
          "node_id",
          "channel",
          "direction",
          "body",
          "metadata",
          "sent_at",
          "idempotency_key",
          "created_at"
        )
        SELECT
          c.id,
          am.automation_id,
          am.execution_id,
          am.node_id,
          am.channel,
          am.direction,
          am.body_preview,
          am.metadata,
          am.sent_at,
          am.idempotency_key,
          am.created_at
        FROM "automation_message" am
        INNER JOIN "conversation" c
          ON c.restaurant_id = am.restaurant_id
         AND c.customer_id = am.customer_id
        ON CONFLICT ("idempotency_key") DO NOTHING
      `);

      await queryRunner.query(`DROP TABLE IF EXISTS "automation_message"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "automation_message" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "automation_id" integer,
        "execution_id" integer,
        "node_id" integer,
        "channel" character varying(16) NOT NULL,
        "direction" character varying(16) NOT NULL DEFAULT 'outbound',
        "body_preview" text NOT NULL,
        "metadata" jsonb,
        "sent_at" TIMESTAMPTZ NOT NULL,
        "idempotency_key" character varying(160) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_automation_message" PRIMARY KEY ("id"),
        CONSTRAINT "FK_automation_message_restaurant_id"
          FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_message_customer_id"
          FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_message_automation_id"
          FOREIGN KEY ("automation_id") REFERENCES "automation"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_message_execution_id"
          FOREIGN KEY ("execution_id") REFERENCES "automation_execution"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_automation_message_node_id"
          FOREIGN KEY ("node_id") REFERENCES "automation_node"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      INSERT INTO "automation_message" (
        "restaurant_id",
        "customer_id",
        "automation_id",
        "execution_id",
        "node_id",
        "channel",
        "direction",
        "body_preview",
        "metadata",
        "sent_at",
        "idempotency_key",
        "created_at"
      )
      SELECT
        c.restaurant_id,
        c.customer_id,
        cm.automation_id,
        cm.execution_id,
        cm.node_id,
        cm.channel,
        cm.direction,
        cm.body,
        cm.metadata,
        cm.sent_at,
        cm.idempotency_key,
        cm.created_at
      FROM "conversation_message" cm
      INNER JOIN "conversation" c ON c.id = cm.conversation_id
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_conversation_message_conversation_sent"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_conversation_restaurant_last_message"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation_message"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversation"`);
  }
}
