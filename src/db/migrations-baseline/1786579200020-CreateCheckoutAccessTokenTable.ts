import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCheckoutAccessTokenTable1786579200020 implements MigrationInterface {
  name = 'CreateCheckoutAccessTokenTable1786579200020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('checkout_access_token');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "checkout_access_token" ("id" SERIAL NOT NULL, "token_hash" character varying(64) NOT NULL, "customer_id" integer NOT NULL, "funnel_id" integer NOT NULL, "business_id" integer NOT NULL, "campaign_id" integer, "funnel_payment_id" integer, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_3763824ca5cf3b2e9b1de741a02" UNIQUE ("token_hash"), CONSTRAINT "PK_113cebeea7fe021e26418d9c263" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_checkout_access_token_customer_funnel" ON "checkout_access_token" ("customer_id", "funnel_id") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_b47769c8bc9be8626a25a09144a' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "checkout_access_token" ADD CONSTRAINT "FK_b47769c8bc9be8626a25a09144a" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_983d431bb763f6be2bcaba9339c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "checkout_access_token" ADD CONSTRAINT "FK_983d431bb763f6be2bcaba9339c" FOREIGN KEY ("funnel_payment_id") REFERENCES "funnel_payment"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "checkout_access_token" CASCADE`);
  }
}
