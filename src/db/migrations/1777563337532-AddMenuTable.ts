import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMenuTable1777563337532 implements MigrationInterface {
  name = 'AddMenuTable1777563337532';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "menus" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "description" text,
        "menu_type" character varying,
        "file_url" character varying(2048),
        "file_name" character varying,
        "file_size" integer,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "restaurant_id" integer NOT NULL,
        CONSTRAINT "PK_3fec3d93327f4538e0cbd4349c4" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "menus" ADD CONSTRAINT "FK_bcd4a935c967cc9c20e770d1e62" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menus" DROP CONSTRAINT "FK_bcd4a935c967cc9c20e770d1e62"`,
    );
    await queryRunner.query(`DROP TABLE "menus"`);
  }
}
