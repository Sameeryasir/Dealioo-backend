import { MigrationInterface, QueryRunner } from 'typeorm';

export class MenuFileUrlText1778000000001 implements MigrationInterface {
  name = 'MenuFileUrlText1778000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menus" ALTER COLUMN "file_url" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "menus" ALTER COLUMN "file_url" TYPE character varying(2048) USING LEFT("file_url", 2048)`,
    );
  }
}
