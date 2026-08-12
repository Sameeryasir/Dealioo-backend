import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFunnelEventTable1786579200021 implements MigrationInterface {
  name = 'CreateFunnelEventTable1786579200021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('funnel_event');
    if (!hasTable) {
      await queryRunner.query(`CREATE TABLE "funnel_event" ("id" SERIAL NOT NULL, "funnel_id" integer, "event_type" "public"."funnel_event_event_type_enum" NOT NULL, "customer_id" integer, "visitor_id" character varying(64), "funnel_payment_id" integer, "amount" integer, "currency" character varying(10), "payment_status" character varying(32), "stripe_payment_intent_id" character varying(255), "customer_email" character varying(320), "receipt_url" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5d2dac1af690f1d52c5cf92f764" PRIMARY KEY ("id"))`);
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_c52343ca3447dc054755e957526' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_event" ADD CONSTRAINT "FK_c52343ca3447dc054755e957526" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_9e67abd9f174ca9044f717d8dd6' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_event" ADD CONSTRAINT "FK_9e67abd9f174ca9044f717d8dd6" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
      }
    }
    {
      const rows = await queryRunner.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_3c6d5096c31b75f88ebf9151da6' LIMIT 1`
      );
      if (!rows.length) {
        await queryRunner.query(`ALTER TABLE "funnel_event" ADD CONSTRAINT "FK_3c6d5096c31b75f88ebf9151da6" FOREIGN KEY ("funnel_payment_id") REFERENCES "funnel_payment"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_event" CASCADE`);
  }
}
