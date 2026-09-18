import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationAndFunnelMemberPermissions1786579200096
  implements MigrationInterface
{
  name = 'AddAutomationAndFunnelMemberPermissions1786579200096';

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
          'automations_create',
          'automations_edit',
          'automations_delete',
          'funnels_edit',
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_member_permissions');
    if (!hasTable) {
      return;
    }

    await queryRunner.query(`
      DELETE FROM "business_member_permissions"
      WHERE "permission" IN (
        'automations_create',
        'automations_edit',
        'automations_delete',
        'funnels_edit'
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
  }
}
