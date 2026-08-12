import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerVisitCampaignsTable1786579200025 implements MigrationInterface {
  name = 'CreateCustomerVisitCampaignsTable1786579200025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('customer_visit_campaigns');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "customer_visit_campaigns" ("id" SERIAL NOT NULL, "customer_visit_id" integer NOT NULL, "campaign_id" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_customer_visit_campaigns_visit_campaign" UNIQUE ("customer_visit_id", "campaign_id"), CONSTRAINT "PK_ca276a42a0b2e045d50f87fec82" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_customer_visit_campaigns_campaign_id" ON "customer_visit_campaigns" ("campaign_id") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_4732ac093b3431a8472e4749eb2' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_visit_campaigns" ADD CONSTRAINT "FK_4732ac093b3431a8472e4749eb2" FOREIGN KEY ("customer_visit_id") REFERENCES "customer_visits"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_e02b6d19ebc7d9502ad1f610767' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "customer_visit_campaigns" ADD CONSTRAINT "FK_e02b6d19ebc7d9502ad1f610767" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_visit_campaigns" CASCADE`);
  }
}
