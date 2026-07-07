import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationMessageSentBySentTo1779340000003
  implements MigrationInterface
{
  name = 'AddConversationMessageSentBySentTo1779340000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      ADD COLUMN IF NOT EXISTS "sent_by_restaurant_id" integer,
      ADD COLUMN IF NOT EXISTS "sent_by_customer_id" integer,
      ADD COLUMN IF NOT EXISTS "sent_to_restaurant_id" integer,
      ADD COLUMN IF NOT EXISTS "sent_to_customer_id" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      ADD CONSTRAINT "FK_conversation_message_sent_by_restaurant_id"
        FOREIGN KEY ("sent_by_restaurant_id") REFERENCES "restaurants"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      ADD CONSTRAINT "FK_conversation_message_sent_by_customer_id"
        FOREIGN KEY ("sent_by_customer_id") REFERENCES "customers"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      ADD CONSTRAINT "FK_conversation_message_sent_to_restaurant_id"
        FOREIGN KEY ("sent_to_restaurant_id") REFERENCES "restaurants"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      ADD CONSTRAINT "FK_conversation_message_sent_to_customer_id"
        FOREIGN KEY ("sent_to_customer_id") REFERENCES "customers"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      UPDATE "conversation_message" cm
      SET
        "sent_by_restaurant_id" = c."restaurant_id",
        "sent_to_customer_id" = c."customer_id"
      FROM "conversation" c
      WHERE c."id" = cm."conversation_id"
        AND cm."direction" = 'outbound'
        AND cm."sent_by_restaurant_id" IS NULL
        AND cm."sent_to_customer_id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      DROP CONSTRAINT IF EXISTS "FK_conversation_message_sent_to_customer_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      DROP CONSTRAINT IF EXISTS "FK_conversation_message_sent_to_restaurant_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      DROP CONSTRAINT IF EXISTS "FK_conversation_message_sent_by_customer_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      DROP CONSTRAINT IF EXISTS "FK_conversation_message_sent_by_restaurant_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "conversation_message"
      DROP COLUMN IF EXISTS "sent_to_customer_id",
      DROP COLUMN IF EXISTS "sent_to_restaurant_id",
      DROP COLUMN IF EXISTS "sent_by_customer_id",
      DROP COLUMN IF EXISTS "sent_by_restaurant_id"
    `);
  }
}
