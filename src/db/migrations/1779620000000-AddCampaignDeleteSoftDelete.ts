import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignDeleteSoftDelete1779620000000
  implements MigrationInterface
{
  name = 'AddCampaignDeleteSoftDelete1779620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'campaigns',
      'customer_visits',
      'redemption_logs',
      'coupons',
      'checkout_access_token',
      'funnel_payment',
      'funnel_order',
      'funnel_event',
      'funnel_analytics_event',
      'customers',
    ] as const;

    for (const table of tables) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL
      `);
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_${table}_deleted_at"
        ON "${table}" ("deleted_at")
      `);
    }

    await queryRunner.query(`
      ALTER TABLE "coupons" DROP CONSTRAINT IF EXISTS "FK_coupons_funnel"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP CONSTRAINT IF EXISTS "FK_funnel_payment_funnel"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_order" DROP CONSTRAINT IF EXISTS "FK_funnel_order_funnel_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_event" DROP CONSTRAINT IF EXISTS "FK_funnel_event_funnel"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_analytics_event"
      DROP CONSTRAINT IF EXISTS "FK_funnel_analytics_event_funnel"
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons" ALTER COLUMN "funnel_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" ALTER COLUMN "funnel_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_order" ALTER COLUMN "funnel_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_event" ALTER COLUMN "funnel_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_analytics_event" ALTER COLUMN "funnel_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "checkout_access_token" ALTER COLUMN "funnel_id" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD CONSTRAINT "FK_coupons_funnel"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD CONSTRAINT "FK_funnel_payment_funnel"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_order"
      ADD CONSTRAINT "FK_funnel_order_funnel_id"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_event"
      ADD CONSTRAINT "FK_funnel_event_funnel"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_analytics_event"
      ADD CONSTRAINT "FK_funnel_analytics_event_funnel"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "coupons" DROP CONSTRAINT IF EXISTS "FK_coupons_funnel"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP CONSTRAINT IF EXISTS "FK_funnel_payment_funnel"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_order" DROP CONSTRAINT IF EXISTS "FK_funnel_order_funnel_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_event" DROP CONSTRAINT IF EXISTS "FK_funnel_event_funnel"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_analytics_event"
      DROP CONSTRAINT IF EXISTS "FK_funnel_analytics_event_funnel"
    `);

    await queryRunner.query(`
      ALTER TABLE "coupons"
      ADD CONSTRAINT "FK_coupons_funnel"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD CONSTRAINT "FK_funnel_payment_funnel"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_order"
      ADD CONSTRAINT "FK_funnel_order_funnel_id"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_event"
      ADD CONSTRAINT "FK_funnel_event_funnel"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_analytics_event"
      ADD CONSTRAINT "FK_funnel_analytics_event_funnel"
      FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id")
      ON DELETE CASCADE
    `);

    const tables = [
      'campaigns',
      'customer_visits',
      'redemption_logs',
      'coupons',
      'checkout_access_token',
      'funnel_payment',
      'funnel_order',
      'funnel_event',
      'funnel_analytics_event',
      'customers',
    ] as const;

    for (const table of tables) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_deleted_at"`);
      await queryRunner.query(`
        ALTER TABLE "${table}" DROP COLUMN IF EXISTS "deleted_at"
      `);
    }
  }
}
