import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessUserConversationReadState1788690000000
  implements MigrationInterface
{
  name = 'CreateBusinessUserConversationReadState1788690000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "business_user_conversation_read_state" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "business_id" integer NOT NULL,
        "conversation_id" integer NOT NULL,
        "last_read_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_business_user_conversation_read_state" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_biz_user_conversation_read"
          UNIQUE ("user_id", "business_id", "conversation_id"),
        CONSTRAINT "FK_biz_user_conv_read_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_biz_user_conv_read_business_id"
          FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_biz_user_conv_read_conversation_id"
          FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_biz_user_conversation_read_business"
        ON "business_user_conversation_read_state" ("business_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_biz_user_conversation_read_business"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "business_user_conversation_read_state"
    `);
  }
}
