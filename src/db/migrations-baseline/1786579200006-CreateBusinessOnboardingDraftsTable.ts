import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBusinessOnboardingDraftsTable1786579200006 implements MigrationInterface {
  name = 'CreateBusinessOnboardingDraftsTable1786579200006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('business_onboarding_drafts');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "business_onboarding_drafts" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "step" character varying(32) NOT NULL DEFAULT 'basics', "payload" jsonb NOT NULL DEFAULT '{}', "logo_url" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a0684ecfdc89c3502a6b1b926a6" UNIQUE ("user_id"), CONSTRAINT "REL_a0684ecfdc89c3502a6b1b926a" UNIQUE ("user_id"), CONSTRAINT "PK_5de60f8b7e9af14afe0c1c87075" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_a0684ecfdc89c3502a6b1b926a6' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "business_onboarding_drafts" ADD CONSTRAINT "FK_a0684ecfdc89c3502a6b1b926a6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "business_onboarding_drafts" CASCADE`);
  }
}
