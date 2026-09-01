import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBusinessTypeAndCurrency1780080000000
  implements MigrationInterface
{
  name = 'AddBusinessTypeAndCurrency1780080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
        ADD COLUMN IF NOT EXISTS "business_type" character varying(64),
        ADD COLUMN IF NOT EXISTS "currency" character varying(3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "businesses"
        DROP COLUMN IF EXISTS "currency",
        DROP COLUMN IF EXISTS "business_type"
    `);
  }
}
