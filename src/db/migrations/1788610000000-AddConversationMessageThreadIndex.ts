import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationMessageThreadIndex1788610000000
  implements MigrationInterface
{
  name = 'AddConversationMessageThreadIndex1788610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_conversation_message_conversation_id"
      ON "conversation_message" ("conversation_id", "id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_conversation_message_conversation_id"
    `);
  }
}
