import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLocationTable1777556327166 implements MigrationInterface {
  name = 'AddLocationTable1777556327166';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "locations" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "address" character varying NOT NULL,
        "city" character varying NOT NULL,
        "state" character varying NOT NULL,
        "country" character varying NOT NULL,
        "postal_code" character varying NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "restaurant_id" integer NOT NULL,
        CONSTRAINT "PK_locations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "locations"
      ADD CONSTRAINT "FK_locations_restaurant_id"
      FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "locations" DROP CONSTRAINT "FK_locations_restaurant_id"`,
    );
    await queryRunner.query(`DROP TABLE "locations"`);
  }
}
