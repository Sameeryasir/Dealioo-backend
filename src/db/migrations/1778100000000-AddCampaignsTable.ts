import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignsTable1778100000000 implements MigrationInterface {
  name = 'AddCampaignsTable1778100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "campaigns_status_enum" AS ENUM ('published', 'unpublished')`,
    );
    await queryRunner.query(`
      CREATE TABLE "campaigns" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "campaign_name" character varying(255) NOT NULL,
        "website_url" character varying(2048) NOT NULL,
        "image_url" text,
        "offer" text,
        "price" numeric(10,2),
        "status" "campaigns_status_enum" NOT NULL DEFAULT 'unpublished',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaigns" PRIMARY KEY ("id"),
        CONSTRAINT "FK_campaigns_restaurant_id" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "campaigns"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "campaigns_status_enum"`);
  }
}
