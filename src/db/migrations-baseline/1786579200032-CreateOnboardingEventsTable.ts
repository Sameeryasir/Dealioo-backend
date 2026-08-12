import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOnboardingEventsTable1786579200032 implements MigrationInterface {
  name = 'CreateOnboardingEventsTable1786579200032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('onboarding_events');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "onboarding_events" ("id" SERIAL NOT NULL, "user_id" integer, "event_name" character varying(64) NOT NULL, "idempotency_key" character varying(191) NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_747557d4de6b1df0e5c494b64bf" UNIQUE ("idempotency_key"), CONSTRAINT "PK_c16d29283f6d2f6cd3a3f001eff" PRIMARY KEY ("id"))`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_onboarding_events_user_created" ON "onboarding_events" ("user_id", "created_at") `);
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_64017f2b4c6d3f5cbdecd1837d4' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "onboarding_events" ADD CONSTRAINT "FK_64017f2b4c6d3f5cbdecd1837d4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "onboarding_events" CASCADE`);
  }
}
