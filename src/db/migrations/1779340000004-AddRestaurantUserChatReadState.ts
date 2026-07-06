import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantUserChatReadState1779340000004
  implements MigrationInterface
{
  name = 'AddRestaurantUserChatReadState1779340000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "restaurant_user_chat_read_state" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "restaurant_id" integer NOT NULL,
        "chats_last_viewed_at" TIMESTAMPTZ NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_restaurant_user_chat_read_state" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_restaurant_user_chat_read_state_user_restaurant"
          UNIQUE ("user_id", "restaurant_id"),
        CONSTRAINT "FK_restaurant_user_chat_read_state_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_restaurant_user_chat_read_state_restaurant_id"
          FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_restaurant_user_chat_read_state_restaurant_id"
        ON "restaurant_user_chat_read_state" ("restaurant_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_restaurant_user_chat_read_state_restaurant_id"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "restaurant_user_chat_read_state"
    `);
  }
}
