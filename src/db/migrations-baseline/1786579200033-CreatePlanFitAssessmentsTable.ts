import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlanFitAssessmentsTable1786579200033 implements MigrationInterface {
  name = 'CreatePlanFitAssessmentsTable1786579200033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('plan_fit_assessments');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "plan_fit_assessments" ("id" SERIAL NOT NULL, "user_id" integer NOT NULL, "version" character varying(32) NOT NULL, "answers" jsonb NOT NULL, "scores" jsonb NOT NULL, "recommended_plan_slug" character varying(64) NOT NULL, "confidence" character varying(16) NOT NULL, "selected_plan_slug" character varying(64), "recommendation_accepted" boolean, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e91b9d2cf14bb8dd3afb2a5999b" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_plan_fit_assessments_user_id" ON "plan_fit_assessments" ("user_id") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_85beca49985ff708946998e6809' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "plan_fit_assessments" ADD CONSTRAINT "FK_85beca49985ff708946998e6809" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_fit_assessments" CASCADE`);
  }
}
