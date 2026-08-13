import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGranularCampaignMemberPermissions1780010000000
  implements MigrationInterface
{
  name = 'AddGranularCampaignMemberPermissions1780010000000';

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
          'campaigns_edit',
          'campaigns_delete',
          'meta_ads',
          'meta_campaigns',
          'meta_campaigns_view',
          'meta_campaigns_create',
          'meta_campaigns_delete',
          'google_campaigns_view',
          'google_campaigns_create',
          'google_campaigns_delete',
          'orders',
          'activity',
          'chats',
          'scanning',
          'members',
          'settings'
        )
      )
    `);

    await queryRunner.query(`
      INSERT INTO "business_member_permissions" ("business_member_id", "permission")
      SELECT
        bmp."business_member_id",
        action.permission
      FROM "business_member_permissions" AS bmp
      CROSS JOIN (
        VALUES
          ('campaigns_view'),
          ('campaigns_create'),
          ('campaigns_edit'),
          ('campaigns_delete'),
          ('google_campaigns_view'),
          ('google_campaigns_create'),
          ('google_campaigns_delete')
      ) AS action(permission)
      WHERE bmp."permission" = 'campaigns'
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "business_member_permissions" ("business_member_id", "permission")
      SELECT bmp."business_member_id", 'meta_campaigns_view'
      FROM "business_member_permissions" AS bmp
      WHERE bmp."permission" = 'meta_ads'
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "business_member_permissions" ("business_member_id", "permission")
      SELECT
        bmp."business_member_id",
        action.permission
      FROM "business_member_permissions" AS bmp
      CROSS JOIN (
        VALUES
          ('meta_campaigns_view'),
          ('meta_campaigns_create'),
          ('meta_campaigns_delete')
      ) AS action(permission)
      WHERE bmp."permission" = 'meta_campaigns'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_member_permissions');
    if (!hasTable) {
      return;
    }

    await queryRunner.query(`
      DELETE FROM "business_member_permissions"
      WHERE "permission" IN (
        'campaigns_view',
        'campaigns_create',
        'campaigns_edit',
        'campaigns_delete',
        'meta_campaigns_view',
        'meta_campaigns_create',
        'meta_campaigns_delete',
        'google_campaigns_view',
        'google_campaigns_create',
        'google_campaigns_delete'
      )
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
          'meta_ads',
          'meta_campaigns',
          'orders',
          'activity',
          'chats',
          'scanning',
          'members',
          'settings'
        )
      )
    `);
  }
}
