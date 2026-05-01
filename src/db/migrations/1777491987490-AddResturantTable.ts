import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResturantTable1777491987490 implements MigrationInterface {
  name = 'AddResturantTable1777491987490';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "restaurants" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "logo_url" character varying(2048),
        "website_url" character varying(2048),
        "email" character varying,
        "phone_number" character varying,
        "branch_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "owner_id" integer NOT NULL,
        CONSTRAINT "PK_restaurants" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "restaurants"
      ADD CONSTRAINT "FK_restaurants_owner_id"
      FOREIGN KEY ("owner_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" DROP CONSTRAINT "FK_restaurants_owner_id"`,
    );
    await queryRunner.query(`DROP TABLE "restaurants"`);
  }
}
