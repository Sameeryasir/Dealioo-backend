import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the existing restaurants table to businesses (no new table).
 * Foreign keys from other tables continue to work after PostgreSQL table rename.
 */
export class RenameRestaurantsTableToBusinesses1779420000000
  implements MigrationInterface
{
  name = 'RenameRestaurantsTableToBusinesses1779420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasRestaurants = await queryRunner.hasTable('restaurants');
    const hasBusinesses = await queryRunner.hasTable('businesses');

    if (!hasRestaurants || hasBusinesses) {
      return;
    }

    await queryRunner.query(`ALTER TABLE "restaurants" RENAME TO "businesses"`);

    await queryRunner.query(`
      ALTER TABLE "businesses"
      RENAME CONSTRAINT "PK_restaurants" TO "PK_businesses"
    `);

    await queryRunner.query(`
      ALTER TABLE "businesses"
      RENAME CONSTRAINT "FK_restaurants_owner_id" TO "FK_businesses_owner_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasBusinesses = await queryRunner.hasTable('businesses');
    const hasRestaurants = await queryRunner.hasTable('restaurants');

    if (!hasBusinesses || hasRestaurants) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "businesses"
      RENAME CONSTRAINT "FK_businesses_owner_id" TO "FK_restaurants_owner_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "businesses"
      RENAME CONSTRAINT "PK_businesses" TO "PK_restaurants"
    `);

    await queryRunner.query(`ALTER TABLE "businesses" RENAME TO "restaurants"`);
  }
}
