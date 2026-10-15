import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignReviewsPermission1786579200122 implements MigrationInterface {
  name = 'AddCampaignReviewsPermission1786579200122';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_member_permissions');
    if (!hasTable) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "business_member_permissions"
      DROP CONSTRAINT IF EXISTS "CHK_business_member_permissions_permission"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_member_permissions"
      ADD CONSTRAINT "CHK_business_member_permissions_permission"
      CHECK (
        "permission" IN (
          'campaigns',
          'campaigns_view',
          'campaigns_create',
          'campaigns_update',
          'campaigns_edit',
          'campaigns_delete',
          'campaigns_guests',
          'campaigns_orders',
          'campaigns_reviews',
          'meta_ads',
          'meta_campaigns',
          'meta_campaigns_view',
          'meta_campaigns_create',
          'meta_campaigns_delete',
          'google_campaigns_view',
          'google_campaigns_create',
          'google_campaigns_delete',
          'automations',
          'automations_create',
          'automations_edit',
          'automations_delete',
          'funnels_edit',
          'orders',
          'activity',
          'history',
          'chats',
          'scanning',
          'members',
          'settings'
        )
      )
    `);

    await queryRunner.query(`
      INSERT INTO "business_member_permissions" ("business_member_id", "permission")
      SELECT DISTINCT bmp."business_member_id", 'campaigns_reviews'
      FROM "business_member_permissions" bmp
      WHERE bmp."permission" IN ('campaigns_guests', 'campaigns_orders', 'campaigns')
        AND NOT EXISTS (
          SELECT 1
          FROM "business_member_permissions" existing
          WHERE existing."business_member_id" = bmp."business_member_id"
            AND existing."permission" = 'campaigns_reviews'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_member_permissions');
    if (!hasTable) {
      return;
    }

    await queryRunner.query(`
      DELETE FROM "business_member_permissions"
      WHERE "permission" = 'campaigns_reviews'
    `);

    await queryRunner.query(`
      ALTER TABLE "business_member_permissions"
      DROP CONSTRAINT IF EXISTS "CHK_business_member_permissions_permission"
    `);

    await queryRunner.query(`
      ALTER TABLE "business_member_permissions"
      ADD CONSTRAINT "CHK_business_member_permissions_permission"
      CHECK (
        "permission" IN (
          'campaigns',
          'campaigns_view',
          'campaigns_create',
          'campaigns_update',
          'campaigns_edit',
          'campaigns_delete',
          'campaigns_guests',
          'campaigns_orders',
          'meta_ads',
          'meta_campaigns',
          'meta_campaigns_view',
          'meta_campaigns_create',
          'meta_campaigns_delete',
          'google_campaigns_view',
          'google_campaigns_create',
          'google_campaigns_delete',
          'automations',
          'automations_create',
          'automations_edit',
          'automations_delete',
          'funnels_edit',
          'orders',
          'activity',
          'history',
          'chats',
          'scanning',
          'members',
          'settings'
        )
      )
    `);
  }
}
