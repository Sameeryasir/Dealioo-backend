import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignMetaCampaignMediaStatus1779860000000
  implements MigrationInterface
{
  name = 'AlignMetaCampaignMediaStatus1779860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "meta_campaign_media"
      SET "media_type" = UPPER("media_type")
      WHERE "media_type" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "meta_campaign_media"
      SET "upload_status" = CASE
        WHEN "meta_image_hash" IS NOT NULL OR "meta_video_id" IS NOT NULL THEN 'META_UPLOADED'
        WHEN LOWER("upload_status") IN ('ready', 'uploaded') THEN 'UPLOADED'
        WHEN LOWER("upload_status") IN ('uploading') THEN 'UPLOADING'
        WHEN LOWER("upload_status") IN ('failed', 'error') THEN 'FAILED'
        ELSE UPPER("upload_status")
      END
    `);

    await queryRunner.query(`
      ALTER TABLE "meta_campaign_media"
      ALTER COLUMN "upload_status" SET DEFAULT 'UPLOADING'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "meta_campaign_media"
      SET "media_type" = LOWER("media_type")
      WHERE "media_type" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "meta_campaign_media"
      SET "upload_status" = CASE
        WHEN "upload_status" = 'META_UPLOADED' THEN 'ready'
        WHEN "upload_status" = 'UPLOADED' THEN 'ready'
        WHEN "upload_status" = 'UPLOADING' THEN 'uploading'
        WHEN "upload_status" = 'FAILED' THEN 'ready'
        ELSE LOWER("upload_status")
      END
    `);

    await queryRunner.query(`
      ALTER TABLE "meta_campaign_media"
      ALTER COLUMN "upload_status" SET DEFAULT 'uploading'
    `);
  }
}
