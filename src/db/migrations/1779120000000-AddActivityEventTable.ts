import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivityEventTable1779120000000 implements MigrationInterface {
  name = 'AddActivityEventTable1779120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "activity_event" (
        "id" SERIAL NOT NULL,
        "restaurant_id" integer NOT NULL,
        "customer_id" integer,
        "event_type" character varying(32) NOT NULL,
        "description" text NOT NULL,
        "metadata" jsonb,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "idempotency_key" character varying(128) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_activity_event" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_activity_event_idempotency" UNIQUE ("idempotency_key"),
        CONSTRAINT "FK_activity_event_restaurant" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_activity_event_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_activity_event_restaurant_occurred"
      ON "activity_event" ("restaurant_id", "occurred_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "activity_event"`);
  }
}
