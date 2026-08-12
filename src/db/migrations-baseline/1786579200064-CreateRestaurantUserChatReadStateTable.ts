import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRestaurantUserChatReadStateTable1786579200064 implements MigrationInterface {
  name = 'CreateRestaurantUserChatReadStateTable1786579200064';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('restaurant_user_chat_read_state');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "restaurant_user_chat_read_state" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "business_id" integer NOT NULL, "chats_last_viewed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_restaurant_user_chat_read_state_user_restaurant" UNIQUE ("user_id", "business_id"), CONSTRAINT "PK_7829081facb08c479c3f7e38930" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_7d439a46144f32c964b840b97c7' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "restaurant_user_chat_read_state" ADD CONSTRAINT "FK_7d439a46144f32c964b840b97c7" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_8630c2d7b0577022fcc283ee0fa' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "restaurant_user_chat_read_state" ADD CONSTRAINT "FK_8630c2d7b0577022fcc283ee0fa" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "restaurant_user_chat_read_state" CASCADE`);
  }
}
