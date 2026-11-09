import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReviewBrandingLinksAndCategories1786579200156
  implements MigrationInterface
{
  name = 'AddReviewBrandingLinksAndCategories1786579200156';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasCategories = await queryRunner.hasColumn(
      'campaign_review',
      'category_ratings',
    );
    if (!hasCategories) {
      await queryRunner.query(`
        ALTER TABLE "campaign_review"
        ADD COLUMN "category_ratings" jsonb
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "campaign_review" DROP COLUMN IF EXISTS "category_ratings"
    `);
  }
}
