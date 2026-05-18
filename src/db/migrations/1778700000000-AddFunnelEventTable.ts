import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFunnelEventTable1778700000000 implements MigrationInterface {
  name = 'AddFunnelEventTable1778700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "funnel_event_event_type_enum" AS ENUM ('signup', 'payment')`,
    );
    await queryRunner.query(`
      CREATE TABLE "funnel_event" (
        "id" SERIAL NOT NULL,
        "funnel_id" integer NOT NULL,
        "event_type" "funnel_event_event_type_enum" NOT NULL,
        "customer_id" integer,
        "visitor_id" character varying(64),
        "funnel_payment_id" integer,
        "amount" integer,
        "currency" character varying(10),
        "payment_status" character varying(32),
        "stripe_payment_intent_id" character varying(255),
        "customer_email" character varying(320),
        "receipt_url" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_funnel_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_funnel_event_funnel" FOREIGN KEY ("funnel_id") REFERENCES "funnels"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_funnel_event_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_funnel_event_funnel_payment" FOREIGN KEY ("funnel_payment_id") REFERENCES "funnel_payment"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "funnel_event"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "funnel_event_event_type_enum"`,
    );
  }
}
