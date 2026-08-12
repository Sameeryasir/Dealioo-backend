import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAutomationTable1786579200053 implements MigrationInterface {
  name = 'CreateAutomationTable1786579200053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('automation');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "automation" ("id" SERIAL NOT NULL, "business_id" integer NOT NULL, "name" character varying(255) NOT NULL, "description" text, "trigger" "public"."automation_trigger_enum" NOT NULL, "purpose" "public"."automation_purpose_enum" NOT NULL DEFAULT 'funnel_signup_payment_reminder', "campaign_id" integer, "funnel_id" integer, "created_by" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT false, "published" boolean NOT NULL DEFAULT false, "is_template" boolean NOT NULL DEFAULT false, "version" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c0430b160cab96bd145ca5297d" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_5544f75171b3f6e64fcdf0dc71d' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation" ADD CONSTRAINT "FK_5544f75171b3f6e64fcdf0dc71d" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_73021235dab2fc0ec0d37c88a4c' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation" ADD CONSTRAINT "FK_73021235dab2fc0ec0d37c88a4c" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_378c936e55dcf2c0bb008c8bb9b' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation" ADD CONSTRAINT "FK_378c936e55dcf2c0bb008c8bb9b" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_2adef673187fc2dc3983a0502d5' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "automation" ADD CONSTRAINT "FK_2adef673187fc2dc3983a0502d5" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "automation" CASCADE`);
  }
}
