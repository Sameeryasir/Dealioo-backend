import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationBusinessLastMessageIndex1788600000000
  implements MigrationInterface
{
  name = 'AddConversationBusinessLastMessageIndex1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_conversation_business_last_message"
      ON "conversation" ("business_id", "last_message_at" DESC)
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_conversation_restaurant_last_message"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_conversation_business_last_message"
    `);
  }
}
