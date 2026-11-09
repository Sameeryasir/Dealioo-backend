import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveBusinessGoogleYelpReviewUrls1786579200157
  implements MigrationInterface
{
  name = 'RemoveBusinessGoogleYelpReviewUrls1786579200157';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses" DROP COLUMN IF EXISTS "yelp_review_url"
    `);
    await queryRunner.query(`
      ALTER TABLE "businesses" DROP COLUMN IF EXISTS "google_review_url"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasGoogle = await queryRunner.hasColumn(
      'businesses',
      'google_review_url',
    );
    if (!hasGoogle) {
      await queryRunner.query(`
        ALTER TABLE "businesses"
        ADD COLUMN "google_review_url" character varying(2048)
      `);
    }

    const hasYelp = await queryRunner.hasColumn(
      'businesses',
      'yelp_review_url',
    );
    if (!hasYelp) {
      await queryRunner.query(`
        ALTER TABLE "businesses"
        ADD COLUMN "yelp_review_url" character varying(2048)
      `);
    }
  }
}
