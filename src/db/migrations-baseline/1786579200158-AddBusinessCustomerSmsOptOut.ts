import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessCustomerSmsOptOut1786579200158
  implements MigrationInterface
{
  name = 'AddBusinessCustomerSmsOptOut1786579200158';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasOptedOut = await queryRunner.hasColumn(
      'business_customers',
      'sms_opted_out',
    );
    if (!hasOptedOut) {
      await queryRunner.query(`
        ALTER TABLE "business_customers"
        ADD COLUMN "sms_opted_out" boolean NOT NULL DEFAULT false
      `);
    }

    const hasOptedOutAt = await queryRunner.hasColumn(
      'business_customers',
      'sms_opted_out_at',
    );
    if (!hasOptedOutAt) {
      await queryRunner.query(`
        ALTER TABLE "business_customers"
        ADD COLUMN "sms_opted_out_at" TIMESTAMP WITH TIME ZONE
      `);
    }

    const hasSource = await queryRunner.hasColumn(
      'business_customers',
      'sms_opt_out_source',
    );
    if (!hasSource) {
      await queryRunner.query(`
        ALTER TABLE "business_customers"
        ADD COLUMN "sms_opt_out_source" character varying(64)
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "business_customers" DROP COLUMN IF EXISTS "sms_opt_out_source"
    `);
    await queryRunner.query(`
      ALTER TABLE "business_customers" DROP COLUMN IF EXISTS "sms_opted_out_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "business_customers" DROP COLUMN IF EXISTS "sms_opted_out"
    `);
  }
}
