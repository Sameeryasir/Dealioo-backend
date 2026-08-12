import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCampaignsTable1786579200013 implements MigrationInterface {
  name = 'CreateCampaignsTable1786579200013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('campaigns');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "campaigns" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "created_by" integer, "campaign_name" character varying(255) NOT NULL, "campaign_type" "public"."campaigns_campaign_type_enum" NOT NULL DEFAULT 'prepaid', "website_url" character varying(2048) NOT NULL, "image_url" text, "offer" text, "price" numeric(10,2), "status" "public"."campaigns_status_enum" NOT NULL DEFAULT 'unpublished', "stripe_product_id" character varying(255), "stripe_price_id" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_831e3fcd4fc45b4e4c3f57a9ee4" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_778013f0785179c0d7ea5c279ea' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "campaigns" ADD CONSTRAINT "FK_778013f0785179c0d7ea5c279ea" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_49da41a196c3d2bd6f5ce1dc3b5' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "campaigns" ADD CONSTRAINT "FK_49da41a196c3d2bd6f5ce1dc3b5" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "campaigns" CASCADE`);
  }
}
