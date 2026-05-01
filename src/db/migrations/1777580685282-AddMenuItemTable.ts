import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMenuItemTable1777580685282 implements MigrationInterface {
    name = 'AddMenuItemTable1777580685282'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "menu_items" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "image_url" character varying(2048), "description" character varying, "price" numeric(10,2), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "menu_id" integer NOT NULL, CONSTRAINT "PK_57e6188f929e5dc6919168620c8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "menu_items" ADD CONSTRAINT "FK_ba71edc684a901b4bc9d9228f42" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "menu_items" DROP CONSTRAINT "FK_ba71edc684a901b4bc9d9228f42"`);
        await queryRunner.query(`DROP TABLE "menu_items"`);
    }

}
