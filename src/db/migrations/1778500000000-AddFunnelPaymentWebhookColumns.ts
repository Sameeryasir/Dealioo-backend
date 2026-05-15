import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelPaymentWebhookColumns1778500000000
  implements MigrationInterface
{
  name = 'AddFunnelPaymentWebhookColumns1778500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "failed_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "cancelled_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment"
      ADD "stripe_refund_id" character varying(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "stripe_refund_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "cancelled_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "funnel_payment" DROP COLUMN "failed_at"
    `);
  }
}
