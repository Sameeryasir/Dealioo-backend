import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelsTable1778200000000 implements MigrationInterface {
  name = 'AddFunnelsTable1778200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnels"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "funnels_status_enum"`);
    await queryRunner.query(
      `CREATE TYPE "funnels_status_enum" AS ENUM ('published', 'unpublished')`,
    );
    await queryRunner.query(`
      CREATE TABLE "funnels" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "campaign_name" character varying(255) NOT NULL,
        "website_url" character varying(2048) NOT NULL,
        "image_url" text,
        "offer" text,
        "price" numeric(10,2),
        "status" "funnels_status_enum" NOT NULL DEFAULT 'unpublished',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_funnels" PRIMARY KEY ("id"),
        CONSTRAINT "FK_funnels_restaurant_id" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnels"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "funnels_status_enum"`);
  }
}
