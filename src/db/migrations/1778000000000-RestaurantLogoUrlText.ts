import { MigrationInterface, QueryRunner } from 'typeorm';

export class RestaurantLogoUrlText1778000000000 implements MigrationInterface {
  name = 'RestaurantLogoUrlText1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" ALTER COLUMN "logo_url" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "restaurants" ALTER COLUMN "logo_url" TYPE character varying(2048) USING LEFT("logo_url", 2048)`,
    );
  }
}
