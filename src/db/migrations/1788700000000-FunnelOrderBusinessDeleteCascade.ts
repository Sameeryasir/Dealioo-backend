import { MigrationInterface, QueryRunner } from 'typeorm';

export class FunnelOrderBusinessDeleteCascade1788700000000
  implements MigrationInterface
{
  name = 'FunnelOrderBusinessDeleteCascade1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('funnel_order'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "funnel_order"
      DROP CONSTRAINT IF EXISTS "FK_funnel_order_business_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "funnel_order"
      ADD CONSTRAINT "FK_funnel_order_business_id"
      FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('funnel_order'))) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "funnel_order"
      DROP CONSTRAINT IF EXISTS "FK_funnel_order_business_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "funnel_order"
      ADD CONSTRAINT "FK_funnel_order_business_id"
      FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
      ON DELETE RESTRICT
    `);
  }
}
